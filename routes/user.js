// routes/user.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();

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
router.post("/add_candidate_cv", async (req, res) => {
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

    const topCandidateIds = new Set(
      candidateRankings
        .slice(0, topCandidatesNumber)
        .map((cand) => cand.candidateId)
    );
    const companyDetails = {
      company: username,
      salary,
      job_description,
      position,
    };

    for (const candId in candidatesForPosition) {
      let notificationObj = {
        message: "",
        company_details: username,
        job_description: job_description,
        salary: salary,
      };
      if (topCandidateIds.has(candId)) {
        if (!candidateData[position][candId].offers_available) {
          candidateData[position][candId].offers_available = [];
        }
        candidateData[position][candId].offers_available.push(companyDetails);
        notificationObj.message = `Congrats! You have been selected for the position ${position}.`;
        candidateData[position][candId].notifications.push(notificationObj);
        candidateData[position][candId].new_notification = 1;
      } else {
        if (!candidateData[position][candId].rejected_from) {
          candidateData[position][candId].rejected_from = [];
        }
        candidateData[position][candId].rejected_from.push(companyDetails);
        notificationObj.message = `Sorry, you have not been selected for the position ${position}.`;
        candidateData[position][candId].notifications.push(notificationObj);
        candidateData[position][candId].new_notification = 1;
      }
    }
    fs.writeFileSync(
      candidateFilePath,
      JSON.stringify(candidateData, null, 2),
      "utf8"
    );

    const globalRankingPath = path.join(__dirname, "../global_ranking.json");
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

    const jdFilePath = path.join(__dirname, "../job_description.json");
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
      candidates: candidateRankings.slice(0, topCandidatesNumber),
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
        candidates: candidateRankings.slice(0, topCandidatesNumber),
        globalRanking: globalRanking[position],
      },
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

    const topCandidateIds = new Set(
      candidateRankings
        .slice(0, topCandidatesNumber)
        .map((cand) => cand.candidateId)
    );
    const companyDetails = {
      company: username,
      salary,
      job_description,
      position,
    };

    for (const candId in candidatesForPosition) {
      let notificationObj = {
        message: "",
        company_details: username,
        job_description: job_description,
        salary: salary,
      };
      if (topCandidateIds.has(candId)) {
        if (!candidateData[position][candId].offers_available) {
          candidateData[position][candId].offers_available = [];
        }
        candidateData[position][candId].offers_available.push(companyDetails);
        notificationObj.message = `Congrats! You have been selected for the position ${position}.`;
        candidateData[position][candId].notifications.push(notificationObj);
        candidateData[position][candId].new_notification = 1;
      } else {
        if (!candidateData[position][candId].rejected_from) {
          candidateData[position][candId].rejected_from = [];
        }
        candidateData[position][candId].rejected_from.push(companyDetails);
        notificationObj.message = `Sorry, you have not been selected for the position ${position}.`;
        candidateData[position][candId].notifications.push(notificationObj);
        candidateData[position][candId].new_notification = 1;
      }
    }
    fs.writeFileSync(
      candidateFilePath,
      JSON.stringify(candidateData, null, 2),
      "utf8"
    );

    const globalRankingPath = path.join(__dirname, "../global_ranking.json");
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

    if (!jobDescData[position]) {
      jobDescData[position] = {};
    }
    jobDescData[position][username] = {
      username,
      Password: password,
      Salary: salary,
      job_description,
      position,
      candidates: candidateRankings.slice(0, topCandidatesNumber),
    };
    fs.writeFileSync(jdFilePath, JSON.stringify(jobDescData, null, 2), "utf8");

    res.json({
      message: "Job description added for new position successfully",
      job_posting: {
        username,
        Password: password,
        Salary: salary,
        job_description,
        position,
        candidates: candidateRankings.slice(0, topCandidatesNumber),
        globalRanking: globalRanking[position],
      },
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
      if (candidateData.hasOwnProperty(pos)) {
        const candidate = candidateData[pos][number];
        if (candidate && candidate.Password === password) {
          const overall_rank =
            (globalRanking[pos] && globalRanking[pos][number]) || "Not Ranked";
          foundCandidates.push({
            position: pos,
            candidateId: number,
            overall_rank,
            ...stripEmbeddings(candidate),
          });
        }
      }
    }
    if (foundCandidates.length > 0) {
      res.json({
        message: "Candidate logged in successfully",
        candidates: foundCandidates,
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
      for (const recruiter in jobDescData[pos]) {
        const jobPost = jobDescData[pos][recruiter];
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
// 8. Clear Notifications
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

module.exports = router;