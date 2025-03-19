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

// --------------------------
// User Registration Helpers
// --------------------------
// Registers a new user by storing the credentials in users.json
function registerUser(username, password) {
  const usersPath = path.join(__dirname, "users.json");
  let users = {};
  if (fs.existsSync(usersPath)) {
    const content = fs.readFileSync(usersPath, "utf8");
    users = content ? JSON.parse(content) : {};
  }
  if (users[username]) {
    throw new Error("User already exists");
  }
  users[username] = { password };
  fs.writeFileSync(usersPath, JSON.stringify(users, null, 2), "utf8");
}

// Verifies the given user credentials from users.json
function verifyUser(username, password) {
  const usersPath = path.join(__dirname, "users.json");
  if (!fs.existsSync(usersPath)) return false;
  const content = fs.readFileSync(usersPath, "utf8");
  const users = content ? JSON.parse(content) : {};
  return users[username] && users[username].password === password;
}

// --------------------------
// Other Helpers
// --------------------------

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
// Two question dictionaries: one for CV and one for JD
// ---------------------------------------------
const cvQuestions = {
  skills: "What skills does this person have?",
  education: "What education does this person have?",
  responsibilities: "What responsibilities can this person handle?",
  experience: "What experience does this person have?",
};

const jdQuestions = {
  skills: "What skills are required?",
  education: "What education is required?",
  responsibilities: "What responsibilities should a person be able to handle?",
  experience: "What experience is required?",
};

// ---------------------------------------------
// Updated queryCV function which takes a 'type' parameter ("cv" or "jd")
// ---------------------------------------------
async function queryCV(question, text, type, attempt = 1) {
  const apiKey = process.env.MISTRAL_API_KEY;
  const url = "https://api.mistral.ai/v1/chat/completions";

  // Choose a system prompt based on the type
  let systemPrompt;
  if (type === "cv") {
    systemPrompt =
      "You are an AI assistant that extracts useful insights from a CV. Answer directly without any preamble.";
  } else if (type === "jd") {
    systemPrompt =
      "You are an AI assistant that extracts useful insights from a job description. Answer directly without any preamble.";
  } else {
    systemPrompt = "You are an AI assistant that extracts useful insights.";
  }

  try {
    const response = await axios.post(
      url,
      {
        model: "mistral-large-2411",
        messages: [
          { role: "system", content: systemPrompt },
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
      return queryCV(question, text, type, attempt + 1);
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

// ---------------------------------------------
// Helper function to remove embedding arrays from candidate objects for response
// ---------------------------------------------
function stripEmbeddings(candidateObj) {
  return {
    Name: candidateObj.Name,
    Password: candidateObj.Password,
    Salary: candidateObj.Salary,
    University: candidateObj.University,
    cv: candidateObj.cv,
    position: candidateObj.position,
    skills: candidateObj.skills
      ? { text: candidateObj.skills.text }
      : undefined,
    education: candidateObj.education
      ? { text: candidateObj.education.text }
      : undefined,
    responsibilities: candidateObj.responsibilities
      ? { text: candidateObj.responsibilities.text }
      : undefined,
    experience: candidateObj.experience
      ? { text: candidateObj.experience.text }
      : undefined,
    ats: candidateObj.ats,
    overall_similarity: candidateObj.overall_similarity,
    similarityScores: candidateObj.similarityScores,
  };
}

// ---------------------------------------------
// User Router: User Registration, Candidate, Job Description, and University Report Endpoints
// ---------------------------------------------
const userRouter = express.Router();

// New Endpoint: User Registration
userRouter.post("/register_user", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res
      .status(400)
      .json({ error: "Both username and password are required." });
  }
  try {
    registerUser(username, password);
    res.json({ message: "User registered successfully", username });
  } catch (error) {
    console.error("Error registering user:", error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint: Register Candidate (uses cvQuestions)
// Now requires "registeredUsername" and "registeredPassword" to verify the user
userRouter.post("/register_candidate", async (req, res) => {
  const {
    registeredUsername,
    registeredPassword,
    number,
    name,
    university,
    cv,
    position,
    password,
    salary,
  } = req.body;

  if (!registeredUsername || !registeredPassword) {
    return res
      .status(400)
      .json({
        error:
          "User credentials (registeredUsername, registeredPassword) are required.",
      });
  }
  if (!verifyUser(registeredUsername, registeredPassword)) {
    return res.status(401).json({ error: "Invalid user credentials." });
  }
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
    // Use cvQuestions for CV extraction
    const skillsText = await queryCV(cvQuestions.skills, cv, "cv");
    const educationText = await queryCV(cvQuestions.education, cv, "cv");
    const responsibilitiesText = await queryCV(
      cvQuestions.responsibilities,
      cv,
      "cv"
    );
    const experienceText = await queryCV(cvQuestions.experience, cv, "cv");

    const skillsEmbedding = await getEmbedding(skillsText);
    const educationEmbedding = await getEmbedding(educationText);
    const responsibilitiesEmbedding = await getEmbedding(responsibilitiesText);
    const experienceEmbedding = await getEmbedding(experienceText);

    // Build candidate object (no university ranking, add similarityScores array)
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
      overall_similarity: 0,
      similarityScores: [],
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
      candidate: stripEmbeddings(candidateDetails),
    });
  } catch (error) {
    console.error("Error registering candidate:", error);
    res
      .status(500)
      .json({ error: "An error occurred while registering the candidate." });
  }
});

// Endpoint: Register Job Description (uses jdQuestions)
// User credentials are provided in "username" and "password", and are verified.
userRouter.post("/register_jd", async (req, res) => {
  const { username, password, salary, job_description, position } = req.body;

  if (!username || !password || !salary || !job_description || !position) {
    return res.status(400).json({
      error:
        "All fields (username, password, salary, job_description, position) are required.",
    });
  }
  if (!verifyUser(username, password)) {
    return res.status(401).json({ error: "Invalid user credentials." });
  }
  if (typeof position !== "string") {
    return res.status(400).json({ error: "Position must be a string." });
  }

  try {
    // Use jdQuestions for job description extraction
    const jdSkills = await queryCV(jdQuestions.skills, job_description, "jd");
    const jdEducation = await queryCV(
      jdQuestions.education,
      job_description,
      "jd"
    );
    const jdResponsibilities = await queryCV(
      jdQuestions.responsibilities,
      job_description,
      "jd"
    );
    const jdExperience = await queryCV(
      jdQuestions.experience,
      job_description,
      "jd"
    );

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

    // For each candidate, compute cosine similarity using embeddings and update overall similarity.
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
      const currentSim =
        (simSkills + simEducation + simResponsibilities + simExperience) / 4;

      // Update candidate's similarityScores array and compute new overall similarity
      if (!candidate.similarityScores) candidate.similarityScores = [];
      candidate.similarityScores.push(currentSim);
      const total = candidate.similarityScores.reduce((a, b) => a + b, 0);
      const overallSim = total / candidate.similarityScores.length;
      candidate.overall_similarity = overallSim;

      // Prepare ranking object for response (strip embeddings)
      let candidateRankingObj = {
        candidateId: candId,
        ...stripEmbeddings(candidate),
        currentJobSim: currentSim,
      };

      candidateRankings.push(candidateRankingObj);
    }

    // Sort candidates by overall_similarity (descending) and assign ranking numbers
    candidateRankings.sort(
      (a, b) => b.overall_similarity - a.overall_similarity
    );
    candidateRankings = candidateRankings.map((cand, index) => ({
      ranking: index + 1,
      ...cand,
    }));

    // Update candidate records in candidate.json with new overall similarity for each candidate
    for (const candObj of candidateRankings) {
      if (
        candidateData[position] &&
        candidateData[position][candObj.candidateId]
      ) {
        candidateData[position][candObj.candidateId].overall_similarity =
          candObj.overall_similarity;
      }
    }
    fs.writeFileSync(
      candidateFilePath,
      JSON.stringify(candidateData, null, 2),
      "utf8"
    );

    // Update the global ranking file (global_ranking.json) with each candidate's ranking per position
    const globalRankingPath = path.join(__dirname, "global_ranking.json");
    let globalRanking = {};
    if (fs.existsSync(globalRankingPath)) {
      const globalRankingContent = fs.readFileSync(globalRankingPath, "utf8");
      globalRanking = globalRankingContent
        ? JSON.parse(globalRankingContent)
        : {};
    }
    if (!globalRanking[position]) {
      globalRanking[position] = {};
    }
    for (const candObj of candidateRankings) {
      globalRanking[position][candObj.candidateId] = candObj.ranking;
    }
    fs.writeFileSync(
      globalRankingPath,
      JSON.stringify(globalRanking, null, 2),
      "utf8"
    );

    // Prepare the job posting object to store in job_description.json (without embeddings)
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
      username,
      Password: password,
      Salary: salary,
      job_description,
      position,
      candidates: candidateRankings,
    };

    fs.writeFileSync(jdFilePath, JSON.stringify(jobDescData, null, 2), "utf8");

    // Respond with the job posting details along with the ranked candidate list (without embeddings)
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

// New Endpoint: University Report
// When provided a payload with username (representing the university name) and password,
// it returns all candidate details (including overall rank) whose "University" field matches the given username.
// The response is sorted in ascending order by overall rank.
userRouter.post("/uni_report", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res
      .status(400)
      .json({ error: "Both username and password are required." });
  }
  // No user credential check is applied here since it's just a report endpoint.
  try {
    const candidateFilePath = path.join(__dirname, "candidate.json");
    let candidateData = {};
    if (fs.existsSync(candidateFilePath)) {
      const fileContent = fs.readFileSync(candidateFilePath, "utf8");
      candidateData = fileContent ? JSON.parse(fileContent) : {};
    }
    // Read global ranking file to fetch overall ranks for candidates per position
    const globalRankingPath = path.join(__dirname, "global_ranking.json");
    let globalRanking = {};
    if (fs.existsSync(globalRankingPath)) {
      const globalRankingContent = fs.readFileSync(globalRankingPath, "utf8");
      globalRanking = globalRankingContent
        ? JSON.parse(globalRankingContent)
        : {};
    }
    let candidatesFromUni = [];
    // Iterate through each position and candidate
    for (const pos in candidateData) {
      for (const candidateId in candidateData[pos]) {
        const candidate = candidateData[pos][candidateId];
        // Check if the candidate's University matches the provided username (assumed to be the university name)
        if (candidate.University === username) {
          // Get overall rank from global ranking for this position
          const overall_rank =
            (globalRanking[pos] && globalRanking[pos][candidateId]) ||
            "Not Ranked";
          candidatesFromUni.push({
            candidateId,
            overall_rank,
            ...stripEmbeddings(candidate),
          });
        }
      }
    }
    // Sort in ascending order by overall_rank (i.e. rank 1, 2, 3, ...)
    candidatesFromUni.sort((a, b) => a.overall_rank - b.overall_rank);
    res.json({
      message: "University report generated successfully",
      candidates: candidatesFromUni,
    });
  } catch (error) {
    console.error("Error generating university report:", error);
    res
      .status(500)
      .json({
        error: "An error occurred while generating the university report.",
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