const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;

require("dotenv").config();

// Helper function: Delay for a given number of milliseconds
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Middleware to parse JSON bodies
app.use(express.json());

// ---------------------------------------------
// Existing Endpoint: Compute Cosine Similarity
// ---------------------------------------------
app.post("/cosine_similarity", async (req, res) => {
  const { text1, text2 } = req.body;
  if (!text1 || !text2) {
    return res
      .status(400)
      .json({ error: "Both text1 and text2 are required." });
  }
  try {
    const response = await axios.post(
      "http://127.0.0.1:8000/cosine_similarity",
      { text1, text2 }
    );
    res.json(response.data);
  } catch (error) {
    console.error("Error computing similarity:", error);
    res
      .status(500)
      .json({ error: "An error occurred while computing similarity." });
  }
});

// ---------------------------------------------
// Utility Function: Query Mistral AI for CV Insights with Retry
// ---------------------------------------------
async function queryCV(question, cvText, attempt = 1) {
  const apiKey = process.env.MISTRAL_API_KEY;
  const url = "https://api.mistral.ai/v1/chat/completions";
  try {
    const response = await axios.post(
      url,
      {
        model: "mistral-large-2411",
        messages: [
          {
            role: "system",
            content:
              "You are an AI assistant that extracts useful insights from a CV.",
          },
          {
            role: "user",
            content: `My CV content:\n\n${cvText}\n\n${question}`,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );
    return response.data.choices[0].message.content;
  } catch (error) {
    if (error.response && error.response.status === 429 && attempt < 3) {
      console.warn(
        `Rate limit exceeded in queryCV. Retrying attempt ${attempt}...`
      );
      await delay(2000); // Wait 2 seconds before retrying
      return queryCV(question, cvText, attempt + 1);
    }
    console.error(
      `Error querying CV for question "${question}":`,
      error.response ? error.response.data : error.message
    );
    return null;
  }
}

// ---------------------------------------------
// Utility Function: Get Embedding from API with Retry
// ---------------------------------------------
async function getEmbedding(text, attempt = 1) {
  try {
    const response = await axios.post("http://127.0.0.1:8000/get_embedding", {
      text: text,
    });
    // Expected response: { "embedding": embedding_list }
    return response.data.embedding;
  } catch (error) {
    if (error.response && error.response.status === 429 && attempt < 3) {
      console.warn(
        `Rate limit exceeded in getEmbedding. Retrying attempt ${attempt}...`
      );
      await delay(2000); // Wait 2 seconds before retrying
      return getEmbedding(text, attempt + 1);
    }
    console.error(
      "Error fetching embedding for text:",
      error.response ? error.response.data : error.message
    );
    return null;
  }
}

// Define questions for CV analysis
const questions = {
  skills: "What are the skills from this CV?",
  education: "What are the educations from this CV?",
  responsibilities: "What responsibilities can this person handle?",
  experience: "What are the experiences mentioned in this CV?",
};

// ---------------------------------------------
// User Router: Handle Candidate Registration and Other User Requests
// ---------------------------------------------
const userRouter = express.Router();

userRouter.post("/register_candidate", async (req, res) => {
  const { number, name, university, cv, position, password, salary } = req.body;

  if (
    !number ||
    !name ||
    !university ||
    !cv ||
    !position ||
    !password ||
    !salary
  ) {
    return res.status(400).json({
      error:
        "All fields (number, name, university, cv, position, password, salary) are required.",
    });
  }

  try {
    // Query the LLM (Mistral AI) for insights from the CV
    const skillsText = await queryCV(questions.skills, cv);
    const educationText = await queryCV(questions.education, cv);
    const responsibilitiesText = await queryCV(questions.responsibilities, cv);
    const experienceText = await queryCV(questions.experience, cv);

    // Query the embedding API for each text insight
    const skillsEmbedding = await getEmbedding(skillsText);
    const educationEmbedding = await getEmbedding(educationText);
    const responsibilitiesEmbedding = await getEmbedding(responsibilitiesText);
    const experienceEmbedding = await getEmbedding(experienceText);

    // Build the candidate object using the new structure
    let candidateDetails = {
      Name: name,
      Password: password, // Use provided password
      Salary: salary, // Store provided salary
      University:
        position.toLowerCase() === "data scientist"
          ? { name: university, rank: "University Rank Unknown" }
          : university,
      cv: cv,
      position: position,
      skills: {
        text: skillsText,
        embedding: skillsEmbedding,
      },
      education: {
        text: educationText,
        embedding: educationEmbedding,
      },
      responsibilities: {
        text: responsibilitiesText,
        embedding: responsibilitiesEmbedding,
      },
      experience: {
        text: experienceText,
        embedding: experienceEmbedding,
      },
      position_rank: "Rank of the candidate dummy for now",
    };

    // Path to candidate JSON file
    const filePath = path.join(__dirname, "candidate.json");

    let data = {};
    // If the file exists, read its current contents
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, "utf8");
      data = fileContent ? JSON.parse(fileContent) : {};
    }

    // Ensure there is a category for the candidate's position
    if (!data[position]) {
      data[position] = {};
    }

    // Add/append the candidate under the candidate's number
    data[position][number] = candidateDetails;

    // Write updated data back to the file (formatted for readability)
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");

    res.json({
      message: "Candidate registered successfully",
      candidate: candidateDetails,
    });
  } catch (error) {
    console.error("Error registering candidate:", error);
    res
      .status(500)
      .json({ error: "An error occurred while registering the candidate." });
  }
});

// Mount the userRouter under the '/user' path
app.use("/user", userRouter);

app.get("/", (res, req) => {
  res.statusMessage("Hello");
});

// ---------------------------------------------
// Start the Server
// ---------------------------------------------
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
