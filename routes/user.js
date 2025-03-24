const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();

const twilio = require("twilio");
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
const client = twilio(accountSid, authToken);

const {
  delay,
  calculateAtsScore,
  computeCosineSimilarity,
  queryCV,
  getEmbedding,
  getCategoryScore,
  stripEmbeddings,
} = require("../helpers");

// ---------------------------------------------
// Define CV and JD questions
// ---------------------------------------------
const cvQuestions = {
  skills:
    "Based solely on the provided CV, extract and list the candidate's skills exactly as mentioned. Do not infer or add any additional skills.",
  education:
    "Based solely on the provided CV, extract and list the candidate's education details exactly as stated. Do not hypothesize or add extra details.",
  responsibilities:
    "Based solely on the provided CV, extract and list the responsibilities the candidate has handled in the past. Do not add any responsibilities that are not explicitly mentioned.",
  experience:
    "Based solely on the provided CV, extract and list the candidate's work experience exactly as presented. Do not infer or add any extra information.",
};

const jdQuestions = {
  skills:
    "Based solely on the provided job description, extract and list the required skills exactly as mentioned. Do not add or infer any additional skills.",
  education:
    "Based solely on the provided job description, extract and list the required education details exactly as stated. Do not add or infer any extra details.",
  responsibilities:
    "Based solely on the provided job description, extract and list the responsibilities required for the job exactly as mentioned. Do not add any additional responsibilities.",
  experience:
    "Based solely on the provided job description, extract and list the required work experience exactly as presented. Do not infer or add any extra details.",
};

// ---------------------------------------------
// Helper function to update global ranking
// ---------------------------------------------
function updateGlobalRanking(position, candidateData) {
  const globalRankingPath = path.join(__dirname, "../global_ranking.json");
  let globalRanking = {};
  if (fs.existsSync(globalRankingPath)) {
    const fileContent = fs.readFileSync(globalRankingPath, "utf8");
    globalRanking = fileContent ? JSON.parse(fileContent) : {};
  }
  // sort candidates for the given position by overall_similarity descending
  let candidatesForPosition = candidateData[position] || {};
  let sortedCandidates = Object.keys(candidatesForPosition)
    .map((candidateId) => {
      return {
        candidateId,
        overall_similarity:
          candidatesForPosition[candidateId].overall_similarity,
      };
    })
    .sort((a, b) => b.overall_similarity - a.overall_similarity);

  let ranking = {};
  sortedCandidates.forEach((cand, index) => {
    ranking[cand.candidateId] = index + 1;
  });
  globalRanking[position] = ranking;
  fs.writeFileSync(
    globalRankingPath,
    JSON.stringify(globalRanking, null, 2),
    "utf8"
  );
}

// ---------------------------------------------
// 1. Register Candidate
// ---------------------------------------------
router.post("/register_candidate", async (req, res) => {
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

    const skillsScore = await getCategoryScore("skills", skillsText, position);
    const educationScore = await getCategoryScore(
      "education",
      educationText,
      position
    );
    const responsibilitiesScore = await getCategoryScore(
      "responsibilities",
      responsibilitiesText,
      position
    );
    const experienceScore = await getCategoryScore(
      "experience",
      experienceText,
      position
    );

    let candidateDetails = {
      Name: name,
      Number: number,
      Password: password,
      Salary: salary,
      University: university,
      cv,
      position,
      skills: {
        text: skillsText,
        embedding: skillsEmbedding,
        score: skillsScore,
      },
      education: {
        text: educationText,
        embedding: educationEmbedding,
        score: educationScore,
      },
      responsibilities: {
        text: responsibilitiesText,
        embedding: responsibilitiesEmbedding,
        score: responsibilitiesScore,
      },
      experience: {
        text: experienceText,
        embedding: experienceEmbedding,
        score: experienceScore,
      },
      ats: "0",
      overall_similarity: 0,
      similarityScores: [],
      offers_available: [],
      rejected_from: [],
      notifications: [],
      new_notification: 0,
    };

    candidateDetails.ats = calculateAtsScore(candidateDetails);

    const candidateFilePath = path.join(__dirname, "../candidate.json");
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

// ---------------------------------------------
// 2. Add Candidate CV for an Additional Position
// ---------------------------------------------
router.post("/candidate_cv", async (req, res) => {
  const { number, password, cv, position } = req.body;
  if (!number || !password || !cv || !position) {
    return res.status(400).json({
      error: "Fields number, password, cv, and position are required.",
    });
  }
  if (typeof position !== "string") {
    return res.status(400).json({ error: "Position must be a string." });
  }
  try {
    const candidateFilePath = path.join(__dirname, "../candidate.json");
    let candidateData = {};
    if (fs.existsSync(candidateFilePath)) {
      const fileContent = fs.readFileSync(candidateFilePath, "utf8");
      candidateData = fileContent ? JSON.parse(fileContent) : {};
    }
    // Check for an existing record in any position for this candidate
    let registeredCandidate = null;
    for (const pos in candidateData) {
      if (
        candidateData[pos][number] &&
        candidateData[pos][number].Password === password
      ) {
        registeredCandidate = candidateData[pos][number];
        break;
      }
    }
    if (!registeredCandidate) {
      return res
        .status(401)
        .json({ error: "Candidate not registered or invalid credentials." });
    }
    // Prevent duplicate CV for the same position
    if (candidateData[position] && candidateData[position][number]) {
      return res
        .status(400)
        .json({ error: "Candidate has already applied for this position." });
    }
    const { Name, University, Salary } = registeredCandidate;
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

    const skillsScore = await getCategoryScore("skills", skillsText, position);
    const educationScore = await getCategoryScore(
      "education",
      educationText,
      position
    );
    const responsibilitiesScore = await getCategoryScore(
      "responsibilities",
      responsibilitiesText,
      position
    );
    const experienceScore = await getCategoryScore(
      "experience",
      experienceText,
      position
    );

    let candidateDetails = {
      Name,
      Password: password,
      Salary,
      University,
      cv,
      position,
      skills: {
        text: skillsText,
        embedding: skillsEmbedding,
        score: skillsScore,
      },
      education: {
        text: educationText,
        embedding: educationEmbedding,
        score: educationScore,
      },
      responsibilities: {
        text: responsibilitiesText,
        embedding: responsibilitiesEmbedding,
        score: responsibilitiesScore,
      },
      experience: {
        text: experienceText,
        embedding: experienceEmbedding,
        score: experienceScore,
      },
      ats: "0",
      overall_similarity: 0,
      similarityScores: [],
      offers_available: [],
      rejected_from: [],
      notifications: [],
      new_notification: 0,
    };
    candidateDetails.ats = calculateAtsScore(candidateDetails);
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
      message: "Candidate CV added for new position successfully",
      candidate: stripEmbeddings(candidateDetails),
    });
  } catch (error) {
    console.error("Error adding candidate CV for new position:", error);
    res.status(500).json({
      error:
        "An error occurred while adding the candidate CV for the new position.",
    });
  }
});

// ---------------------------------------------
// 3. Register Job Description
// ---------------------------------------------
router.post("/register_jd", async (req, res) => {
  const {
    username,
    password,
    salary,
    job_description,
    position,
    topCandidates,
  } = req.body;
  if (
    !username ||
    !password ||
    !salary ||
    !job_description ||
    !position ||
    !topCandidates
  ) {
    return res.status(400).json({
      error:
        "All fields (username, password, salary, job_description, position, topCandidates) are required.",
    });
  }
  if (typeof position !== "string") {
    return res.status(400).json({ error: "Position must be a string." });
  }
  if (isNaN(topCandidates) || parseInt(topCandidates) <= 0) {
    return res
      .status(400)
      .json({ error: "topCandidates must be a positive number." });
  }
  const topCandidatesNumber = parseInt(topCandidates);
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

    const candidateFilePath = path.join(__dirname, "../candidate.json");
    let candidateData = {};
    if (fs.existsSync(candidateFilePath)) {
      const fileContent = fs.readFileSync(candidateFilePath, "utf8");
      candidateData = fileContent ? JSON.parse(fileContent) : {};
    }
    const candidatesForPosition = candidateData[position] || {};

    let candidateRankings = [];
    for (const candId in candidatesForPosition) {
      const candidate = candidatesForPosition[candId];
      const simSkills =
        parseFloat(candidate.skills.score || 0) === 0
          ? 0
          : await computeCosineSimilarity(
              candidate.skills.embedding,
              jdSkillsEmbedding
            );
      const simEducation =
        parseFloat(candidate.education.score || 0) === 0
          ? 0
          : await computeCosineSimilarity(
              candidate.education.embedding,
              jdEducationEmbedding
            );
      const simResponsibilities =
        parseFloat(candidate.responsibilities.score || 0) === 0
          ? 0
          : await computeCosineSimilarity(
              candidate.responsibilities.embedding,
              jdResponsibilitiesEmbedding
            );
      const simExperience =
        parseFloat(candidate.experience.score || 0) === 0
          ? 0
          : await computeCosineSimilarity(
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
        ...candidate,
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

    // Instead of immediately updating candidate records with offers and notifications,
    // store the candidate rankings in the job description record along with empty arrays
    // for selected/rejected and accepted/declined candidates.
    const companyDetails = {
      company: username,
      salary,
      job_description,
      position,
    };

    const jdFilePath = path.join(__dirname, "../job_description.json");
    let jobDescData = {};
    if (fs.existsSync(jdFilePath)) {
      const fileContent = fs.readFileSync(jdFilePath, "utf8");
      jobDescData = fileContent ? JSON.parse(fileContent) : {};
    }
    if (!jobDescData[position]) {
      jobDescData[position] = {};
    }
    // Add notifications field for recruiter posting
    jobDescData[position][username] = {
      username,
      Password: password,
      Salary: salary,
      job_description,
      position,
      candidate_rankings: candidateRankings, // store full rankings
      selected_candidates: [],
      rejected_candidates: [],
      candidates_accepted: [],
      candidates_declined: [],
      notifications: [],
      new_notification: 0,
    };

    fs.writeFileSync(jdFilePath, JSON.stringify(jobDescData, null, 2), "utf8");

    // Update global ranking file
    updateGlobalRanking(position, candidateData);

    res.json({
      message: "Job description registered successfully",
      job_posting: jobDescData[position][username],
    });
  } catch (error) {
    console.error("Error registering job description:", error);
    res.status(500).json({
      error: "An error occurred while registering the job description.",
    });
  }
});

// ---------------------------------------------
// 4. Add Job Description for an Additional Position
// ---------------------------------------------
router.post("/add_job_description_cv", async (req, res) => {
  const {
    username,
    password,
    salary,
    job_description,
    position,
    topCandidates,
  } = req.body;
  if (
    !username ||
    !password ||
    !salary ||
    !job_description ||
    !position ||
    !topCandidates
  ) {
    return res.status(400).json({
      error:
        "All fields (username, password, salary, job_description, position, topCandidates) are required.",
    });
  }
  if (typeof position !== "string") {
    return res.status(400).json({ error: "Position must be a string." });
  }
  if (isNaN(topCandidates) || parseInt(topCandidates) <= 0) {
    return res
      .status(400)
      .json({ error: "topCandidates must be a positive number." });
  }
  const topCandidatesNumber = parseInt(topCandidates);
  try {
    const jdFilePath = path.join(__dirname, "../job_description.json");
    let jobDescData = {};
    if (fs.existsSync(jdFilePath)) {
      const fileContent = fs.readFileSync(jdFilePath, "utf8");
      jobDescData = fileContent ? JSON.parse(fileContent) : {};
    }
    let recruiterFound = false;
    for (const pos in jobDescData) {
      for (const rec in jobDescData[pos]) {
        if (
          jobDescData[pos][rec].username === username &&
          jobDescData[pos][rec].Password === password
        ) {
          recruiterFound = true;
          break;
        }
      }
      if (recruiterFound) break;
    }
    if (!recruiterFound) {
      return res
        .status(401)
        .json({ error: "Recruiter not registered or invalid credentials." });
    }
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

    const candidateFilePath = path.join(__dirname, "../candidate.json");
    let candidateData = {};
    if (fs.existsSync(candidateFilePath)) {
      const fileContent = fs.readFileSync(candidateFilePath, "utf8");
      candidateData = fileContent ? JSON.parse(fileContent) : {};
    }
    const candidatesForPosition = candidateData[position] || {};

    let candidateRankings = [];
    for (const candId in candidatesForPosition) {
      const candidate = candidatesForPosition[candId];
      const simSkills =
        parseFloat(candidate.skills.score || 0) === 0
          ? 0
          : await computeCosineSimilarity(
              candidate.skills.embedding,
              jdSkillsEmbedding
            );
      const simEducation =
        parseFloat(candidate.education.score || 0) === 0
          ? 0
          : await computeCosineSimilarity(
              candidate.education.embedding,
              jdEducationEmbedding
            );
      const simResponsibilities =
        parseFloat(candidate.responsibilities.score || 0) === 0
          ? 0
          : await computeCosineSimilarity(
              candidate.responsibilities.embedding,
              jdResponsibilitiesEmbedding
            );
      const simExperience =
        parseFloat(candidate.experience.score || 0) === 0
          ? 0
          : await computeCosineSimilarity(
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
        ...candidate,
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

    // Instead of updating candidate records directly,
    // store the candidate rankings in the job description record along with empty arrays.
    if (!jobDescData[position]) {
      jobDescData[position] = {};
    }
    // Add notifications field for recruiter posting
    jobDescData[position][username] = {
      username,
      Password: password,
      Salary: salary,
      job_description,
      position,
      candidate_rankings: candidateRankings, // store full rankings
      selected_candidates: [],
      rejected_candidates: [],
      candidates_accepted: [],
      candidates_declined: [],
      notifications: [],
      new_notification: 0,
    };
    fs.writeFileSync(jdFilePath, JSON.stringify(jobDescData, null, 2), "utf8");

    // Update global ranking file
    updateGlobalRanking(position, candidateData);

    res.json({
      message: "Job description added for new position successfully",
      job_posting: jobDescData[position][username],
    });
  } catch (error) {
    console.error("Error adding job description for new position:", error);
    res.status(500).json({
      error:
        "An error occurred while adding the job description for the new position.",
    });
  }
});

// ---------------------------------------------
// 5. University Report
// ---------------------------------------------
router.post("/uni_report", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res
      .status(400)
      .json({ error: "Both username and password are required." });
  }
  try {
    const candidateFilePath = path.join(__dirname, "../candidate.json");
    let candidateData = {};
    if (fs.existsSync(candidateFilePath)) {
      const fileContent = fs.readFileSync(candidateFilePath, "utf8");
      candidateData = fileContent ? JSON.parse(fileContent) : {};
    }
    const globalRankingPath = path.join(__dirname, "../global_ranking.json");
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
          candidatesFromUni.push({ candidateId, overall_rank, ...candidate });
        }
      }
    }
    candidatesFromUni.sort((a, b) => a.overall_rank - b.overall_rank);
    res.json({
      message: "University report generated successfully",
      candidates: candidatesFromUni.map((cand) => stripEmbeddings(cand)),
    });
  } catch (error) {
    console.error("Error generating university report:", error);
    res.status(500).json({
      error: "An error occurred while generating the university report.",
    });
  }
});

// ---------------------------------------------
// 6. Candidate Login
// ---------------------------------------------
router.post("/login_candidate", async (req, res) => {
  const { number, password } = req.body;
  if (!number || !password) {
    return res
      .status(400)
      .json({ error: "Both number and password are required." });
  }
  try {
    const candidateFilePath = path.join(__dirname, "../candidate.json");
    let candidateData = {};
    if (fs.existsSync(candidateFilePath)) {
      const fileContent = fs.readFileSync(candidateFilePath, "utf8");
      candidateData = fileContent ? JSON.parse(fileContent) : {};
    }
    const globalRankingPath = path.join(__dirname, "../global_ranking.json");
    let globalRanking = {};
    if (fs.existsSync(globalRankingPath)) {
      const rankingContent = fs.readFileSync(globalRankingPath, "utf8");
      globalRanking = rankingContent ? JSON.parse(rankingContent) : {};
    }
    let foundCandidates = [];
    for (const pos in candidateData) {
      if (
        candidateData[pos][number] &&
        candidateData[pos][number].Password === password
      ) {
        const overall_rank =
          (globalRanking[pos] && globalRanking[pos][number]) || "Not Ranked";
        // Update the candidate record with global ranking
        candidateData[pos][number].overall_rank = overall_rank;
        foundCandidates.push({
          position: pos,
          candidateId: number,
          ...candidateData[pos][number],
        });
      }
    }
    fs.writeFileSync(
      candidateFilePath,
      JSON.stringify(candidateData, null, 2),
      "utf8"
    );
    if (foundCandidates.length > 0) {
      res.json({
        message: "Candidate logged in successfully",
        candidates: foundCandidates.map((cand) => ({
          ...stripEmbeddings(cand),
          overall_rank: cand.overall_rank,
        })),
      });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  } catch (error) {
    console.error("Error logging in candidate:", error);
    res
      .status(500)
      .json({ error: "An error occurred while logging in the candidate." });
  }
});

// ---------------------------------------------
// 7. Recruiter Login
// ---------------------------------------------
router.post("/login_jd", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res
      .status(400)
      .json({ error: "Both username and password are required." });
  }
  try {
    const jdFilePath = path.join(__dirname, "../job_description.json");
    let jobDescData = {};
    if (fs.existsSync(jdFilePath)) {
      const fileContent = fs.readFileSync(jdFilePath, "utf8");
      jobDescData = fileContent ? JSON.parse(fileContent) : {};
    }
    let foundJobDescriptions = [];
    for (const pos in jobDescData) {
      for (const rec in jobDescData[pos]) {
        const jobPost = jobDescData[pos][rec];
        if (jobPost.username === username && jobPost.Password === password) {
          foundJobDescriptions.push(jobPost);
        }
      }
    }
    if (foundJobDescriptions.length > 0) {
      res.json({
        message: "Recruiter logged in successfully",
        job_postings: foundJobDescriptions,
      });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  } catch (error) {
    console.error("Error logging in recruiter:", error);
    res
      .status(500)
      .json({ error: "An error occurred while logging in the recruiter." });
  }
});

// ---------------------------------------------
// 8. Clear Candidate Notifications
// ---------------------------------------------
router.post("/clear_notification", async (req, res) => {
  const { number, password, position } = req.body;
  if (!number || !password || !position) {
    return res
      .status(400)
      .json({ error: "Fields number, password, and position are required." });
  }
  try {
    const candidateFilePath = path.join(__dirname, "../candidate.json");
    let candidateData = {};
    if (fs.existsSync(candidateFilePath)) {
      const fileContent = fs.readFileSync(candidateFilePath, "utf8");
      candidateData = fileContent ? JSON.parse(fileContent) : {};
    }
    if (!candidateData[position] || !candidateData[position][number]) {
      return res
        .status(404)
        .json({ error: "Candidate not found for the given position." });
    }
    if (candidateData[position][number].Password !== password) {
      return res.status(401).json({ error: "Invalid credentials." });
    }
    candidateData[position][number].new_notification = 0;
    fs.writeFileSync(
      candidateFilePath,
      JSON.stringify(candidateData, null, 2),
      "utf8"
    );
    res.json({ message: "Notifications cleared successfully." });
  } catch (error) {
    console.error("Error clearing notifications:", error);
    res
      .status(500)
      .json({ error: "An error occurred while clearing notifications." });
  }
});

// ---------------------------------------------
// 9. Feedback Endpoint (For Multiple CVs)
// ---------------------------------------------
router.post("/feedback", async (req, res) => {
  const { number, password } = req.body;
  if (!number || !password) {
    return res
      .status(400)
      .json({ error: "Both number and password are required." });
  }
  try {
    // Load candidate data
    const candidateFilePath = path.join(__dirname, "../candidate.json");
    if (!fs.existsSync(candidateFilePath)) {
      return res.status(404).json({ error: "No candidate data found." });
    }
    const fileContent = fs.readFileSync(candidateFilePath, "utf8");
    const candidateData = fileContent ? JSON.parse(fileContent) : {};

    // Collect all candidate records (across positions) matching the given number & password
    let candidateRecords = [];
    for (const pos in candidateData) {
      if (
        candidateData[pos][number] &&
        candidateData[pos][number].Password === password
      ) {
        candidateRecords.push({
          position: pos,
          candidate: candidateData[pos][number],
        });
      }
    }
    if (candidateRecords.length === 0) {
      return res
        .status(404)
        .json({ error: "Candidate not found or invalid credentials." });
    }

    // For each candidate record (i.e. for each position) generate feedback
    let feedbackResults = {};
    for (const record of candidateRecords) {
      const candidateRecord = record.candidate;
      const position = record.position;
      // Get all candidates for the same position and sort by overall_similarity (descending)
      const candidatesForPosition = candidateData[position];
      let candidateArray = Object.keys(candidatesForPosition).map((candId) => ({
        candidateId: candId,
        ...candidatesForPosition[candId],
      }));
      candidateArray.sort(
        (a, b) => b.overall_similarity - a.overall_similarity
      );
      const topCandidates = candidateArray.slice(0, 5);

      // Compose the aggregated text: candidate's own CV and top candidate CVs
      let aggregatedCVText = `User CV:\n${candidateRecord.cv}\n\nTop 5 Candidate CVs:\n`;
      topCandidates.forEach((cand, index) => {
        aggregatedCVText += `Candidate ${index + 1} (ID: ${
          cand.candidateId
        }):\n${cand.cv}\n\n`;
      });

      // Create a prompt asking for detailed feedback
      const feedbackPrompt =
        "Based on the provided user CV and the top 5 candidate CVs, please provide specific and actionable feedback on what areas the user should improve to better align with or exceed the top candidates. " +
        "Focus on key sections such as skills, education, responsibilities, and work experience. Provide clear suggestions for improvement." +
        "Just give the feedback in the single paragraph. Make it sound like real feedback that would be given to a person.(Use you) to mention the person. Don't mention other candidate names based on the position that the person is applying for";
      // Call the LLM via queryCV. Using type "cv" for extraction.
      const feedbackResponse = await queryCV(
        feedbackPrompt,
        aggregatedCVText,
        "cv"
      );
      // Save feedback result for this position
      feedbackResults[position] = {
        candidate: stripEmbeddings(candidateRecord),
        feedback: feedbackResponse,
      };
    }
    res.json({
      message: "Feedback generated successfully",
      feedback: feedbackResults,
    });
  } catch (error) {
    console.error("Error generating feedback:", error);
    res
      .status(500)
      .json({ error: "An error occurred while generating feedback." });
  }
});

// ---------------------------------------------
// 10. Recruiter Decision Endpoint
// ---------------------------------------------
// This endpoint allows the recruiter to either select or reject a candidate.
// If selected, the candidate is added to the "selected_candidates" key in the job description record,
// the company details are added to the candidate's "offers_available",
// and a notification is sent to the candidate.
// If rejected, the candidate is added to the "rejected_candidates" key in the job description record,
// and the company details are added to the candidate's "rejected_from".
router.post("/recruiter_decision", async (req, res) => {
  const { username, password, position, candidateId, decision } = req.body;
  if (!username || !password || !position || !candidateId || !decision) {
    return res.status(400).json({
      error:
        "All fields (username, password, position, candidateId, decision) are required.",
    });
  }
  if (decision !== "select" && decision !== "reject") {
    return res
      .status(400)
      .json({ error: "Decision must be either 'select' or 'reject'." });
  }
  try {
    // Load job description data
    const jdFilePath = path.join(__dirname, "../job_description.json");
    let jobDescData = {};
    if (fs.existsSync(jdFilePath)) {
      const fileContent = fs.readFileSync(jdFilePath, "utf8");
      jobDescData = fileContent ? JSON.parse(fileContent) : {};
    }
    if (!jobDescData[position] || !jobDescData[position][username]) {
      return res.status(404).json({
        error: "Job posting not found for given position and recruiter.",
      });
    }
    const jobPosting = jobDescData[position][username];
    // Check recruiter credentials
    if (jobPosting.Password !== password) {
      return res.status(401).json({ error: "Invalid credentials." });
    }
    // Prepare company details from the job posting
    const companyDetails = {
      company: username,
      salary: jobPosting.Salary,
      job_description: jobPosting.job_description,
      position: jobPosting.position,
    };
    // Load candidate data
    const candidateFilePath = path.join(__dirname, "../candidate.json");
    let candidateData = {};
    if (fs.existsSync(candidateFilePath)) {
      const fileContent = fs.readFileSync(candidateFilePath, "utf8");
      candidateData = fileContent ? JSON.parse(fileContent) : {};
    }
    // Process the decision
    if (decision === "select") {
      if (!jobPosting.selected_candidates) jobPosting.selected_candidates = [];
      if (!jobPosting.selected_candidates.includes(candidateId)) {
        jobPosting.selected_candidates.push(candidateId);
      }
      // Update candidate record: add company details to offers_available and send notification
      if (candidateData[position] && candidateData[position][candidateId]) {
        if (!candidateData[position][candidateId].offers_available) {
          candidateData[position][candidateId].offers_available = [];
        }
        if (
          !candidateData[position][candidateId].offers_available.find(
            (o) => o.company === username
          )
        ) {
          candidateData[position][candidateId].offers_available.push(
            companyDetails
          );
        }
        // Add notification for candidate
        if (!candidateData[position][candidateId].notifications) {
          candidateData[position][candidateId].notifications = [];
        }
        candidateData[position][candidateId].notifications.push(
          `You have been selected by ${username} for the position of ${position}. You will be contacted soon by the company representatives.`
        );
        candidateData[position][candidateId].new_notification =
          (candidateData[position][candidateId].new_notification || 0) + 1;

        // Send SMS via Twilio for selection
        const candidatePhone = candidateData[position][candidateId].Number;
        console.log(candidatePhone);
        client.messages
          .create({
            body: `You have been selected by ${username}.`,
            from: twilioPhoneNumber,
            to: candidatePhone,
          })
          .then((message) => console.log("Twilio message SID:", message.sid))
          .catch((error) =>
            console.error("Twilio error sending selection SMS:", error)
          );
      }
    } else if (decision === "reject") {
      if (!jobPosting.rejected_candidates) jobPosting.rejected_candidates = [];
      if (!jobPosting.rejected_candidates.includes(candidateId)) {
        jobPosting.rejected_candidates.push(candidateId);
      }
      // Update candidate record: add company details to rejected_from
      if (candidateData[position] && candidateData[position][candidateId]) {
        if (!candidateData[position][candidateId].rejected_from) {
          candidateData[position][candidateId].rejected_from = [];
        }
        if (
          !candidateData[position][candidateId].rejected_from.find(
            (o) => o.company === username
          )
        ) {
          candidateData[position][candidateId].rejected_from.push(
            companyDetails
          );
        }

        // Send SMS via Twilio for rejection
        const candidatePhone = candidateData[position][candidateId].phone;
        // client.messages
        //   .create({
        //     body: `You have been rejected by ${username}.`,
        //     from: twilioPhoneNumber,
        //     to: candidatePhone,
        //   })
        //   .then((message) => console.log("Twilio message SID:", message.sid))
        //   .catch((error) =>
        //     console.error("Twilio error sending rejection SMS:", error)
        //   );
      }
    }
    // Save updated job description and candidate data
    fs.writeFileSync(jdFilePath, JSON.stringify(jobDescData, null, 2), "utf8");
    fs.writeFileSync(
      candidateFilePath,
      JSON.stringify(candidateData, null, 2),
      "utf8"
    );
    res.json({ message: "Recruiter decision processed successfully." });
  } catch (error) {
    console.error("Error processing recruiter decision:", error);
    res.status(500).json({
      error: "An error occurred while processing the recruiter decision.",
    });
  }
});

// ---------------------------------------------
// 11. Candidate Offer Response Endpoint
// ---------------------------------------------
// This endpoint allows a candidate to respond to a company offer.
// If accepted, the offer is added to the candidate's "accepted_offer" and the candidate is added to
// the job posting's "candidates_accepted". A notification is sent to the recruiter.
// If rejected, the offer is added to the candidate's "declined_offer" and the candidate is added to
// the job posting's "candidates_declined". A notification is also sent to the recruiter.
router.post("/candidate_offer_response", async (req, res) => {
  const { number, password, position, company, decision } = req.body;
  if (!number || !password || !position || !company || !decision) {
    return res.status(400).json({
      error:
        "All fields (number, password, position, company, decision) are required.",
    });
  }
  if (decision !== "accept" && decision !== "reject") {
    return res
      .status(400)
      .json({ error: "Decision must be either 'accept' or 'reject'." });
  }
  try {
    // Load candidate data
    const candidateFilePath = path.join(__dirname, "../candidate.json");
    let candidateData = {};
    if (fs.existsSync(candidateFilePath)) {
      const fileContent = fs.readFileSync(candidateFilePath, "utf8");
      candidateData = fileContent ? JSON.parse(fileContent) : {};
    }
    if (!candidateData[position] || !candidateData[position][number]) {
      return res
        .status(404)
        .json({ error: "Candidate not found for the given position." });
    }
    const candidate = candidateData[position][number];
    if (candidate.Password !== password) {
      return res.status(401).json({ error: "Invalid credentials." });
    }
    // Check if candidate has an offer from the company
    if (
      !candidate.offers_available ||
      !candidate.offers_available.find((o) => o.company === company)
    ) {
      return res
        .status(400)
        .json({ error: "No offer available from the specified company." });
    }
    // Load job description data
    const jdFilePath = path.join(__dirname, "../job_description.json");
    let jobDescData = {};
    if (fs.existsSync(jdFilePath)) {
      const fileContent = fs.readFileSync(jdFilePath, "utf8");
      jobDescData = fileContent ? JSON.parse(fileContent) : {};
    }
    if (!jobDescData[position] || !jobDescData[position][company]) {
      return res.status(404).json({
        error: "Job posting not found for the given position and company.",
      });
    }
    const jobPosting = jobDescData[position][company];
    // Process candidate's decision
    if (decision === "accept") {
      if (!candidate.accepted_offer) candidate.accepted_offer = [];
      if (!candidate.accepted_offer.find((o) => o.company === company)) {
        candidate.accepted_offer.push(
          candidate.offers_available.find((o) => o.company === company)
        );
      }
      if (!jobPosting.candidates_accepted) jobPosting.candidates_accepted = [];
      if (!jobPosting.candidates_accepted.includes(number)) {
        jobPosting.candidates_accepted.push(number);
      }
      // Send notification to recruiter
      if (!jobPosting.notifications) jobPosting.notifications = [];
      jobPosting.notifications.push(
        `Candidate ${number} has accepted your offer.`
      );
      jobPosting.new_notification = (jobPosting.new_notification || 0) + 1;
    } else if (decision === "reject") {
      if (!candidate.declined_offer) candidate.declined_offer = [];
      if (!candidate.declined_offer.find((o) => o.company === company)) {
        candidate.declined_offer.push(
          candidate.offers_available.find((o) => o.company === company)
        );
      }
      if (!jobPosting.candidates_declined) jobPosting.candidates_declined = [];
      if (!jobPosting.candidates_declined.includes(number)) {
        jobPosting.candidates_declined.push(number);
      }
      // Send notification to recruiter
      if (!jobPosting.notifications) jobPosting.notifications = [];
      jobPosting.notifications.push(
        `Candidate ${number} has rejected your offer.`
      );
      jobPosting.new_notification = (jobPosting.new_notification || 0) + 1;
    }
    // Save updated candidate and job description data
    fs.writeFileSync(
      candidateFilePath,
      JSON.stringify(candidateData, null, 2),
      "utf8"
    );
    fs.writeFileSync(jdFilePath, JSON.stringify(jobDescData, null, 2), "utf8");
    res.json({ message: "Candidate offer response processed successfully." });
  } catch (error) {
    console.error("Error processing candidate offer response:", error);
    res.status(500).json({
      error: "An error occurred while processing the candidate offer response.",
    });
  }
});

// ---------------------------------------------
// 12. Clear Recruiter Notifications Endpoint
// ---------------------------------------------
router.post("/clear_notification_recruiter", async (req, res) => {
  const { username, password, position } = req.body;
  if (!username || !password || !position) {
    return res
      .status(400)
      .json({ error: "Fields username, password, and position are required." });
  }
  try {
    const jdFilePath = path.join(__dirname, "../job_description.json");
    let jobDescData = {};
    if (fs.existsSync(jdFilePath)) {
      const fileContent = fs.readFileSync(jdFilePath, "utf8");
      jobDescData = fileContent ? JSON.parse(fileContent) : {};
    }
    if (!jobDescData[position] || !jobDescData[position][username]) {
      return res.status(404).json({
        error: "Job posting not found for given position and recruiter.",
      });
    }
    let jobPosting = jobDescData[position][username];
    jobPosting.new_notification = 0;
    fs.writeFileSync(jdFilePath, JSON.stringify(jobDescData, null, 2), "utf8");
    res.json({ message: "Recruiter notifications cleared successfully." });
  } catch (error) {
    console.error("Error clearing recruiter notifications:", error);
    res.status(500).json({
      error: "An error occurred while clearing recruiter notifications.",
    });
  }
});

module.exports = router;
