const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const http = require("http");

const app = express();
const PORT = process.env.PORT || 3000;
require("dotenv").config();

app.use(express.json());

// --------------------------------------------------
// Helper functions for delays and ATS score calculation
// --------------------------------------------------
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

// --------------------------------------------------
// Cosine similarity: Calls FastAPI endpoint expecting payload {embedding1, embedding2}
// --------------------------------------------------
async function computeCosineSimilarity(embedding1, embedding2, attempt = 1) {
  try {
    const response = await axios.post("http://0.0.0.0:8000/cosine_similarity", {
      embedding1,
      embedding2,
    });
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

// --------------------------------------------------
// Functions for querying the AI (Mistral) for insights and embeddings
// --------------------------------------------------
async function queryCV(question, text, type, attempt = 1) {
  const apiKey = process.env.MISTRAL_API_KEY;
  const url = "https://api.mistral.ai/v1/chat/completions";
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

// --------------------------------------------------
// Helper to strip embedding arrays from candidate objects for responses
// --------------------------------------------------
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

// --------------------------------------------------
// User registration helpers (store credentials in separate files)
// --------------------------------------------------
function registerCandidateUser(phone, password) {
  const filePath = path.join(__dirname, "candidateUsers.json");
  let users = {};
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, "utf8");
    users = content ? JSON.parse(content) : {};
  }
  if (users[phone]) throw new Error("Candidate user already exists");
  users[phone] = { password };
  fs.writeFileSync(filePath, JSON.stringify(users, null, 2), "utf8");
}

function verifyCandidateUser(phone, password) {
  const filePath = path.join(__dirname, "candidateUsers.json");
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, "utf8");
  const users = content ? JSON.parse(content) : {};
  return users[phone] && users[phone].password === password;
}

function registerRecruiterUser(username, password) {
  const filePath = path.join(__dirname, "recruiterUsers.json");
  let users = {};
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, "utf8");
    users = content ? JSON.parse(content) : {};
  }
  if (users[username]) throw new Error("Recruiter already exists");
  users[username] = { password };
  fs.writeFileSync(filePath, JSON.stringify(users, null, 2), "utf8");
}

function verifyRecruiterUser(username, password) {
  const filePath = path.join(__dirname, "recruiterUsers.json");
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, "utf8");
  const users = content ? JSON.parse(content) : {};
  return users[username] && users[username].password === password;
}

// --------------------------------------------------
// Endpoints
// --------------------------------------------------
const userRouter = express.Router();

// Candidate User Registration
userRouter.post("/register_candidate_user", (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) {
    return res
      .status(400)
      .json({ error: "Both phone and password are required." });
  }
  try {
    registerCandidateUser(phone, password);
    res.json({ message: "Candidate user registered successfully", phone });
  } catch (error) {
    console.error("Error registering candidate user:", error);
    res.status(500).json({ error: error.message });
  }
});

// Recruiter Registration
userRouter.post("/register_recruiter", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res
      .status(400)
      .json({ error: "Both username and password are required." });
  }
  try {
    registerRecruiterUser(username, password);
    res.json({ message: "Recruiter registered successfully", username });
  } catch (error) {
    console.error("Error registering recruiter:", error);
    res.status(500).json({ error: error.message });
  }
});

// Candidate Registration (CV submission) - Renamed endpoint "/candidate"
// Requires candidate user credentials: candidatePhone and candidatePassword
userRouter.post("/candidate", async (req, res) => {
  const {
    candidatePhone,
    candidatePassword,
    number,
    name,
    university,
    cv,
    position,
    password,
    salary,
  } = req.body;
  if (!candidatePhone || !candidatePassword) {
    return res
      .status(400)
      .json({
        error:
          "Candidate user credentials are required (candidatePhone, candidatePassword).",
      });
  }
  if (!verifyCandidateUser(candidatePhone, candidatePassword)) {
    return res
      .status(401)
      .json({ error: "Invalid candidate user credentials." });
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
        "All candidate fields (number, name, university, cv, position, password, salary) are required.",
    });
  }
  if (typeof position !== "string") {
    return res.status(400).json({ error: "Position must be a string." });
  }
  try {
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

// Job Description Registration (JD submission) - Renamed endpoint "/jd"
// Requires recruiter credentials: username and password (verified against recruiterUsers.json)
userRouter.post("/jd", async (req, res) => {
  const { username, password, salary, job_description, position } = req.body;
  if (!username || !password || !salary || !job_description || !position) {
    return res.status(400).json({
      error:
        "All fields (username, password, salary, job_description, position) are required.",
    });
  }
  if (!verifyRecruiterUser(username, password)) {
    return res.status(401).json({ error: "Invalid recruiter credentials." });
  }
  if (typeof position !== "string") {
    return res.status(400).json({ error: "Position must be a string." });
  }
  try {
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

    const candidateFilePath = path.join(__dirname, "candidate.json");
    let candidateData = {};
    if (fs.existsSync(candidateFilePath)) {
      const fileContent = fs.readFileSync(candidateFilePath, "utf8");
      candidateData = fileContent ? JSON.parse(fileContent) : {};
    }
    const candidatesForPosition = candidateData[position] || {};

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

      if (!candidate.similarityScores) candidate.similarityScores = [];
      candidate.similarityScores.push(currentSim);
      const total = candidate.similarityScores.reduce((a, b) => a + b, 0);
      const overallSim = total / candidate.similarityScores.length;
      candidate.overall_similarity = overallSim;

      let candidateRankingObj = {
        candidateId: candId,
        ...stripEmbeddings(candidate),
        currentJobSim: currentSim,
      };

      candidateRankings.push(candidateRankingObj);
    }

    candidateRankings.sort(
      (a, b) => b.overall_similarity - a.overall_similarity
    );
    candidateRankings = candidateRankings.map((cand, index) => ({
      ranking: index + 1,
      ...cand,
    }));

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

    // Global ranking per position stored in global_ranking.json
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

// University Report endpoint remains unchanged.
userRouter.post("/uni_report", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res
      .status(400)
      .json({ error: "Both username and password are required." });
  }
  try {
    const candidateFilePath = path.join(__dirname, "candidate.json");
    let candidateData = {};
    if (fs.existsSync(candidateFilePath)) {
      const fileContent = fs.readFileSync(candidateFilePath, "utf8");
      candidateData = fileContent ? JSON.parse(fileContent) : {};
    }
    const globalRankingPath = path.join(__dirname, "global_ranking.json");
    let globalRanking = {};
    if (fs.existsSync(globalRankingPath)) {
      const globalRankingContent = fs.readFileSync(globalRankingPath, "utf8");
      globalRanking = globalRankingContent
        ? JSON.parse(globalRankingContent)
        : {};
    }
    let candidatesFromUni = [];
    for (const pos in candidateData) {
      for (const candidateId in candidateData[pos]) {
        const candidate = candidateData[pos][candidateId];
        if (candidate.University === username) {
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

// Test route
userRouter.get("/", (req, res) => {
  res.status(200).json({ msg: "Hello world!" });
});

app.use("/user", userRouter);

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