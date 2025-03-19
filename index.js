const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const http = require("http");

const app = express();
const PORT = process.env.PORT || 3000;
require("dotenv").config();

// Helper function: Delay for a given number of milliseconds
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Function to calculate the ATS score (based on skills and experience text lengths)
function calculateAtsScore(candidate) {
  const skillsTextLength =
    candidate.skills && candidate.skills.text
      ? candidate.skills.text.length
      : 0;
  const experienceTextLength =
    candidate.experience && candidate.experience.text
      ? candidate.experience.text.length
      : 0;
  let score = (skillsTextLength + experienceTextLength) / 20;
  if (score > 100) score = 100;
  return score.toFixed(2);
}

// Function to compute cosine similarity by calling the FastAPI endpoint.
// The FastAPI expects a payload: { "embedding1": [...], "embedding2": [...] }
async function computeCosineSimilarity(embedding1, embedding2, attempt = 1) {
  try {
    const response = await axios.post("http://0.0.0.0:8000/cosine_similarity", {
      embedding1,
      embedding2,
    });
    // FastAPI returns { "cosine_similarity": <value> }
    return response.data.cosine_similarity;
  } catch (error) {
    if (error.response && error.response.status === 429 && attempt < 3) {
      console.warn(
        `Rate limit exceeded in computeCosineSimilarity. Retrying attempt ${attempt}...`
      );
      await delay(2000);
      return computeCosineSimilarity(embedding1, embedding2, attempt + 1);
    }
    console.error(
      "Error computing cosine similarity:",
      error.response ? error.response.data : error.message
    );
    return 0;
  }
}

// Middleware to parse JSON bodies
app.use(express.json());

// ---------------------------------------------
// Utility Functions: queryCV and getEmbedding, and Questions
// ---------------------------------------------
async function queryCV(question, text, attempt = 1) {
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
            content: "You are an AI assistant that extracts useful insights.",
          },
          {
            role: "user",
            content: `Text:\n\n${text}\n\nQuestion: ${question}`,
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
      await delay(2000);
      return queryCV(question, text, attempt + 1);
    }
    console.error(
      `Error querying CV for question "${question}":`,
      error.response ? error.response.data : error.message
    );
    return "";
  }
}

async function getEmbedding(text, attempt = 1) {
  try {
    const response = await axios.post("http://0.0.0.0:8000/get_embedding", {
      text,
    });
    return response.data.embedding;
  } catch (error) {
    if (error.response && error.response.status === 429 && attempt < 3) {
      console.warn(
        `Rate limit exceeded in getEmbedding. Retrying attempt ${attempt}...`
      );
      await delay(2000);
      return getEmbedding(text, attempt + 1);
    }
    console.error(
      "Error fetching embedding for text:",
      error.response ? error.response.data : error.message
    );
    return null;
  }
}

// Questions used for extracting insights
const questions = {
  skills: "What are the skills required?",
  education: "What are the educational requirements?",
  responsibilities: "What are the key responsibilities?",
  experience: "What experience is required?",
};

// ---------------------------------------------
// User Router: Candidate and Job Description Endpoints
// ---------------------------------------------
const userRouter = express.Router();

// Endpoint: Register Candidate
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

  if (typeof position !== "string") {
    return res.status(400).json({ error: "Position must be a string." });
  }

  try {
    // Process the CV for each required field
    const skillsText = await queryCV(questions.skills, cv);
    const educationText = await queryCV(questions.education, cv);
    const responsibilitiesText = await queryCV(questions.responsibilities, cv);
    const experienceText = await queryCV(questions.experience, cv);

    const skillsEmbedding = await getEmbedding(skillsText);
    const educationEmbedding = await getEmbedding(educationText);
    const responsibilitiesEmbedding = await getEmbedding(responsibilitiesText);
    const experienceEmbedding = await getEmbedding(experienceText);

    // Build candidate object (no redundant "category" field)
    let candidateDetails = {
      Name: name,
      Password: password,
      Salary: salary,
      University: university,
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
      ats: "0",
      university_ranking: "University Rank Unknown",
      overall_ranking: "Overall Rank Unknown",
    };

    candidateDetails.ats = calculateAtsScore(candidateDetails);

    // Save candidate details in candidate.json under key "position"
    const candidateFilePath = path.join(__dirname, "candidate.json");
    let candidateData = {};
    if (fs.existsSync(candidateFilePath)) {
      const fileContent = fs.readFileSync(candidateFilePath, "utf8");
      candidateData = fileContent ? JSON.parse(fileContent) : {};
    }
    if (!candidateData[position]) {
      candidateData[position] = {};
    }
    candidateData[position][number] = candidateDetails;
    fs.writeFileSync(
      candidateFilePath,
      JSON.stringify(candidateData, null, 2),
      "utf8"
    );

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

// Endpoint: Register Job Description (register_jd)
userRouter.post("/register_jd", async (req, res) => {
  const { username, password, salary, job_description, position } = req.body;

  if (!username || !password || !salary || !job_description || !position) {
    return res.status(400).json({
      error:
        "All fields (username, password, salary, job_description, position) are required.",
    });
  }

  if (typeof position !== "string") {
    return res.status(400).json({ error: "Position must be a string." });
  }

  try {
    // Process the job description similar to a CV
    const jdSkills = await queryCV(questions.skills, job_description);
    const jdEducation = await queryCV(questions.education, job_description);
    const jdResponsibilities = await queryCV(
      questions.responsibilities,
      job_description
    );
    const jdExperience = await queryCV(questions.experience, job_description);

    const jdSkillsEmbedding = await getEmbedding(jdSkills);
    const jdEducationEmbedding = await getEmbedding(jdEducation);
    const jdResponsibilitiesEmbedding = await getEmbedding(jdResponsibilities);
    const jdExperienceEmbedding = await getEmbedding(jdExperience);

    // Build the job description object (including embeddings)
    const jobDescObj = {
      username,
      Password: password,
      Salary: salary,
      job_description,
      position,
      embeddings: {
        skills: { text: jdSkills, embedding: jdSkillsEmbedding },
        education: { text: jdEducation, embedding: jdEducationEmbedding },
        responsibilities: {
          text: jdResponsibilities,
          embedding: jdResponsibilitiesEmbedding,
        },
        experience: { text: jdExperience, embedding: jdExperienceEmbedding },
      },
    };

    // Retrieve candidates for the same position from candidate.json
    const candidateFilePath = path.join(__dirname, "candidate.json");
    let candidateData = {};
    if (fs.existsSync(candidateFilePath)) {
      const fileContent = fs.readFileSync(candidateFilePath, "utf8");
      candidateData = fileContent ? JSON.parse(fileContent) : {};
    }
    const candidatesForPosition = candidateData[position] || {};

    // For each candidate, compute cosine similarity using embeddings and prepare ranking object.
    let candidateRankings = [];
    for (const candId in candidatesForPosition) {
      const candidate = candidatesForPosition[candId];
      const simSkills = await computeCosineSimilarity(
        candidate.skills.embedding,
        jdSkillsEmbedding
      );
      const simEducation = await computeCosineSimilarity(
        candidate.education.embedding,
        jdEducationEmbedding
      );
      const simResponsibilities = await computeCosineSimilarity(
        candidate.responsibilities.embedding,
        jdResponsibilitiesEmbedding
      );
      const simExperience = await computeCosineSimilarity(
        candidate.experience.embedding,
        jdExperienceEmbedding
      );
      const averageSim =
        (simSkills + simEducation + simResponsibilities + simExperience) / 4;

      let candidateRankingObj = {
        candidateId: candId,
        Name: candidate.Name,
        Password: candidate.Password,
        Salary: candidate.Salary,
        University: candidate.University,
        cv: candidate.cv,
        position: candidate.position,
        // Include the text details for each field:
        skills: candidate.skills.text,
        education: candidate.education.text,
        responsibilities: candidate.responsibilities.text,
        experience: candidate.experience.text,
        ats: candidate.ats,
        university_ranking: candidate.university_ranking,
        overall_ranking: candidate.overall_ranking,
        similarityScore: averageSim,
      };

      candidateRankings.push(candidateRankingObj);
    }

    // Sort candidates by similarity score (descending) and assign ranking numbers
    candidateRankings.sort((a, b) => b.similarityScore - a.similarityScore);
    candidateRankings = candidateRankings.map((cand, index) => ({
      ranking: index + 1,
      ...cand,
    }));

    // Prepare the job posting object to store in job_description.json
    const jobPosting = {
      username,
      Password: password,
      Salary: salary,
      job_description,
      position,
      candidates: {},
    };
    candidateRankings.forEach((cand) => {
      jobPosting.candidates[cand.candidateId] = cand;
    });

    // Read (or create) job_description.json and add this posting under the given position and username
    const jdFilePath = path.join(__dirname, "job_description.json");
    let jobDescData = {};
    if (fs.existsSync(jdFilePath)) {
      const fileContent = fs.readFileSync(jdFilePath, "utf8");
      jobDescData = fileContent ? JSON.parse(fileContent) : {};
    }
    if (!jobDescData[position]) {
      jobDescData[position] = {};
    }
    jobDescData[position][username] = {
      ...jobPosting,
      embeddings: jobDescObj.embeddings,
    };

    fs.writeFileSync(jdFilePath, JSON.stringify(jobDescData, null, 2), "utf8");

    // Respond with the job posting details along with the ranked candidate list (including text details)
    res.json({
      message: "Job description registered successfully",
      job_posting: {
        username,
        Password: password,
        Salary: salary,
        job_description,
        position,
        candidates: candidateRankings,
      },
    });
  } catch (error) {
    console.error("Error registering job description:", error);
    res
      .status(500)
      .json({
        error: "An error occurred while registering the job description.",
      });
  }
});

// Mount the userRouter under the '/user' path
app.use("/user", userRouter);

// A simple test route
app.get("/", (req, res) => {
  res.status(200).json({ msg: "Hello world!" });
});

// ---------------------------------------------
// Start the Server with Error Handling
// ---------------------------------------------
const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use. Please close the other process or use a different port.`
    );
    process.exit(1);
  } else {
    throw error;
  }
});