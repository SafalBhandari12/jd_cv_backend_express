// helpers.js
const axios = require("axios");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// Helper function: Delay for a given number of milliseconds
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Calculate the ATS score using the average of category scores.
// If a candidate category score is missing, it is treated as 0.
function calculateAtsScore(candidate) {
  const skillsScore =
    candidate.skills && candidate.skills.score
      ? parseFloat(candidate.skills.score)
      : 0;
  const educationScore =
    candidate.education && candidate.education.score
      ? parseFloat(candidate.education.score)
      : 0;
  const responsibilitiesScore =
    candidate.responsibilities && candidate.responsibilities.score
      ? parseFloat(candidate.responsibilities.score)
      : 0;
  const experienceScore =
    candidate.experience && candidate.experience.score
      ? parseFloat(candidate.experience.score)
      : 0;

  const total =
    skillsScore + educationScore + responsibilitiesScore + experienceScore;
  let score = total / 4;

  if (score > 100) score = 100;
  if (score < 0) score = 0;

  return score.toFixed(2);
}

// Compute cosine similarity by calling the FastAPI endpoint.
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

// Query CV (or JD) text extraction from the LLM API.
async function queryCV(question, text, type, attempt = 1) {
  const apiKey = process.env.MISTRAL_API_KEY;
  const url = "https://api.mistral.ai/v1/chat/completions";
  let systemPrompt;
  if (type === "cv") {
    systemPrompt =
      "You are an AI assistant that extracts only the data explicitly mentioned in the provided CV. Do not hypothesize or add any additional data. Answer directly without any preamble.";
  } else if (type === "jd") {
    systemPrompt =
      "You are an AI assistant that extracts only the data explicitly mentioned in the provided job description. Do not infer or add any additional details. Answer directly without any preamble.";
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

// Get the embedding for a given text by calling the FastAPI endpoint.
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

// Get a robust score (0-100) for a candidate's category using the LLM.
async function getCategoryScore(category, categoryText, position, attempt = 1) {
  const apiKey = process.env.MISTRAL_API_KEY;
  const url = "https://api.mistral.ai/v1/chat/completions";

  const systemPrompt = "You are an expert evaluator for candidate profiles.";
  const userPrompt =
    `Evaluate the candidate's ${category} for the position "${position}".\n\n` +
    `Act like you are the ats score calculator. Give the score based on that` +
    `Candidate's ${category} content: "${categoryText}"\n\n` +
    `Score the candidate's ${category} using these criteria:\n` +
    `1. Relevance (0-40): How well does the content address the essential requirements? (0 if completely irrelevant, 40 if perfectly aligned.)\n` +
    `2. Depth & Detail (0-30): How comprehensive is the provided information? (0 for minimal detail, 30 for exceptional depth.)\n` +
    `3. Clarity & Specificity (0-20): How clear and specific is the description? (0 if vague, 20 if very specific.)\n` +
    `4. Impact (0-10): How impressive and compelling is the information? (0 if unimpressive, 10 if outstanding.)\n\n` +
    `For inferior candidate data, the total score should be below 20; for superior data, above 80. Return only the final numeric score (0 to 100) with no extra commentary.`;

  try {
    const response = await axios.post(
      url,
      {
        model: "mistral-large-2411",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );
    const scoreText = response.data.choices[0].message.content.trim();
    const score = parseFloat(scoreText);
    return isNaN(score) ? "0" : score.toFixed(2);
  } catch (error) {
    if (error.response && error.response.status === 429 && attempt < 3) {
      console.warn(
        `Rate limit exceeded in getCategoryScore. Retrying attempt ${attempt}...`
      );
      await delay(2000);
      return getCategoryScore(category, categoryText, position, attempt + 1);
    }
    console.error(
      `Error getting score for ${category}:`,
      error.response ? error.response.data : error.message
    );
    return "0";
  }
}

// Remove embedding arrays from candidate objects for response
function stripEmbeddings(candidateObj) {
  return {
    Name: candidateObj.Name,
    Password: candidateObj.Password,
    Salary: candidateObj.Salary,
    University: candidateObj.University,
    cv: candidateObj.cv,
    position: candidateObj.position,
    skills: candidateObj.skills
      ? { text: candidateObj.skills.text, score: candidateObj.skills.score }
      : undefined,
    education: candidateObj.education
      ? {
          text: candidateObj.education.text,
          score: candidateObj.education.score,
        }
      : undefined,
    responsibilities: candidateObj.responsibilities
      ? {
          text: candidateObj.responsibilities.text,
          score: candidateObj.responsibilities.score,
        }
      : undefined,
    experience: candidateObj.experience
      ? {
          text: candidateObj.experience.text,
          score: candidateObj.experience.score,
        }
      : undefined,
    ats: candidateObj.ats,
    overall_similarity: candidateObj.overall_similarity,
    similarityScores: candidateObj.similarityScores,
  };
}

module.exports = {
  delay,
  calculateAtsScore,
  computeCosineSimilarity,
  queryCV,
  getEmbedding,
  getCategoryScore,
  stripEmbeddings,
};