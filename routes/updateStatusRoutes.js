const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();

// Optional: you can require helper functions if needed
const { stripEmbeddings } = require("../helpers");

/**
 * Endpoint: Update Candidate Selection Status
 *
 * This endpoint is used by the recruiter to either select or reject a candidate.
 * Request Body should include:
 *  - username: Recruiter’s username (company identifier)
 *  - password: Recruiter’s password
 *  - position: Position/job role
 *  - candidateId: Candidate’s unique identifier (number)
 *  - action: Either "select" or "reject"
 *
 * If the candidate is selected:
 *   - The candidateId is added to a "selected_candidates" array in the job description record.
 *   - The company details are added to the candidate's "offers_available" array.
 *
 * If the candidate is rejected:
 *   - The candidateId is added to a "rejected_candidate" array in the job description record.
 *   - The company details are added to the candidate's "rejected_from" array.
 */
router.post("/update_candidate_selection", async (req, res) => {
  const { username, password, position, candidateId, action } = req.body;
  if (!username || !password || !position || !candidateId || !action) {
    return res.status(400).json({
      error:
        "All fields (username, password, position, candidateId, action) are required.",
    });
  }
  if (action !== "select" && action !== "reject") {
    return res
      .status(400)
      .json({ error: "Action must be either 'select' or 'reject'." });
  }
  try {
    // Load the job description data.
    const jdFilePath = path.join(__dirname, "../job_description.json");
    let jobDescData = {};
    if (fs.existsSync(jdFilePath)) {
      const jdContent = fs.readFileSync(jdFilePath, "utf8");
      jobDescData = jdContent ? JSON.parse(jdContent) : {};
    }

    // Load the candidate data.
    const candidateFilePath = path.join(__dirname, "../candidate.json");
    let candidateData = {};
    if (fs.existsSync(candidateFilePath)) {
      const candContent = fs.readFileSync(candidateFilePath, "utf8");
      candidateData = candContent ? JSON.parse(candContent) : {};
    }

    // Validate that the recruiter exists for the given position.
    if (!jobDescData[position] || !jobDescData[position][username]) {
      return res
        .status(401)
        .json({ error: "Recruiter not registered or invalid credentials." });
    }
    if (jobDescData[position][username].Password !== password) {
      return res.status(401).json({ error: "Invalid recruiter credentials." });
    }

    // Validate candidate exists for the given position.
    if (!candidateData[position] || !candidateData[position][candidateId]) {
      return res
        .status(404)
        .json({ error: "Candidate not found for the given position." });
    }

    // Prepare the company details from the job description record.
    const companyDetails = {
      company: username,
      salary: jobDescData[position][username].Salary,
      job_description: jobDescData[position][username].job_description,
      position: position,
    };

    // Process the action.
    if (action === "select") {
      // Update job description: add candidateId to selected_candidates.
      if (!jobDescData[position][username].selected_candidates) {
        jobDescData[position][username].selected_candidates = [];
      }
      if (
        !jobDescData[position][username].selected_candidates.includes(
          candidateId
        )
      ) {
        jobDescData[position][username].selected_candidates.push(candidateId);
      }
      // Update candidate: add companyDetails to offers_available.
      if (!candidateData[position][candidateId].offers_available) {
        candidateData[position][candidateId].offers_available = [];
      }
      const alreadyOffered = candidateData[position][
        candidateId
      ].offers_available.some(
        (offer) => offer.company === companyDetails.company
      );
      if (!alreadyOffered) {
        candidateData[position][candidateId].offers_available.push(
          companyDetails
        );
      }
    } else if (action === "reject") {
      // Update job description: add candidateId to rejected_candidate.
      if (!jobDescData[position][username].rejected_candidate) {
        jobDescData[position][username].rejected_candidate = [];
      }
      if (
        !jobDescData[position][username].rejected_candidate.includes(
          candidateId
        )
      ) {
        jobDescData[position][username].rejected_candidate.push(candidateId);
      }
      // Update candidate: add companyDetails to rejected_from.
      if (!candidateData[position][candidateId].rejected_from) {
        candidateData[position][candidateId].rejected_from = [];
      }
      const alreadyRejected = candidateData[position][
        candidateId
      ].rejected_from.some((offer) => offer.company === companyDetails.company);
      if (!alreadyRejected) {
        candidateData[position][candidateId].rejected_from.push(companyDetails);
      }
    }

    // Write updates back to the JSON files.
    fs.writeFileSync(jdFilePath, JSON.stringify(jobDescData, null, 2), "utf8");
    fs.writeFileSync(
      candidateFilePath,
      JSON.stringify(candidateData, null, 2),
      "utf8"
    );

    return res.json({
      message: "Candidate selection status updated successfully.",
    });
  } catch (error) {
    console.error("Error updating candidate selection status:", error);
    return res.status(500).json({
      error: "An error occurred while updating candidate selection status.",
    });
  }
});

/**
 * Endpoint: Update Offer Response
 *
 * This endpoint is used by the candidate to respond to a job offer.
 * Request Body should include:
 *  - number: Candidate’s unique identifier
 *  - password: Candidate’s password
 *  - position: Position/job role
 *  - company: The recruiter/company that made the offer
 *  - action: Either "accept" or "decline"
 *
 * If accepted:
 *   - The offer is removed from the candidate's "offers_available" list and added to an "accepted_offer" array.
 *   - The candidate's ID is added to a new "candidates_accepted" array in the job description record.
 *
 * If declined:
 *   - The offer is removed from the candidate's "offers_available" list and added to a "declined_offer" array.
 *   - The candidate's ID is added to a new "candidates_declined" array in the job description record.
 */
router.post("/update_offer_response", async (req, res) => {
  const { number, password, position, company, action } = req.body;
  if (!number || !password || !position || !company || !action) {
    return res.status(400).json({
      error:
        "All fields (number, password, position, company, action) are required.",
    });
  }
  if (action !== "accept" && action !== "decline") {
    return res
      .status(400)
      .json({ error: "Action must be either 'accept' or 'decline'." });
  }
  try {
    // Load candidate data.
    const candidateFilePath = path.join(__dirname, "../candidate.json");
    let candidateData = {};
    if (fs.existsSync(candidateFilePath)) {
      const candContent = fs.readFileSync(candidateFilePath, "utf8");
      candidateData = candContent ? JSON.parse(candContent) : {};
    }
    // Validate candidate existence.
    if (!candidateData[position] || !candidateData[position][number]) {
      return res
        .status(404)
        .json({ error: "Candidate not found for the given position." });
    }
    if (candidateData[position][number].Password !== password) {
      return res.status(401).json({ error: "Invalid candidate credentials." });
    }

    // Load job description data.
    const jdFilePath = path.join(__dirname, "../job_description.json");
    let jobDescData = {};
    if (fs.existsSync(jdFilePath)) {
      const jdContent = fs.readFileSync(jdFilePath, "utf8");
      jobDescData = jdContent ? JSON.parse(jdContent) : {};
    }
    if (!jobDescData[position] || !jobDescData[position][company]) {
      return res.status(404).json({
        error: "Job description not found for the given company and position.",
      });
    }
    const jobRecord = jobDescData[position][company];

    // Check that the candidate has an offer available from this company.
    if (
      !candidateData[position][number].offers_available ||
      !candidateData[position][number].offers_available.some(
        (offer) => offer.company === company
      )
    ) {
      return res.status(400).json({
        error:
          "No available offer found from the specified company for this candidate.",
      });
    }

    if (action === "accept") {
      // Update candidate: add to accepted_offer.
      if (!candidateData[position][number].accepted_offer) {
        candidateData[position][number].accepted_offer = [];
      }
      const alreadyAccepted = candidateData[position][
        number
      ].accepted_offer.some((offer) => offer.company === company);
      if (!alreadyAccepted) {
        candidateData[position][number].accepted_offer.push({
          ...jobRecord,
          company,
        });
      }
      // Update job description: add candidate to candidates_accepted.
      if (!jobRecord.candidates_accepted) {
        jobRecord.candidates_accepted = [];
      }
      if (!jobRecord.candidates_accepted.includes(number)) {
        jobRecord.candidates_accepted.push(number);
      }
      // Remove the offer from offers_available.
      candidateData[position][number].offers_available = candidateData[
        position
      ][number].offers_available.filter((offer) => offer.company !== company);
    } else if (action === "decline") {
      // Update candidate: add to declined_offer.
      if (!candidateData[position][number].declined_offer) {
        candidateData[position][number].declined_offer = [];
      }
      const alreadyDeclined = candidateData[position][
        number
      ].declined_offer.some((offer) => offer.company === company);
      if (!alreadyDeclined) {
        candidateData[position][number].declined_offer.push({
          ...jobRecord,
          company,
        });
      }
      // Update job description: add candidate to candidates_declined.
      if (!jobRecord.candidates_declined) {
        jobRecord.candidates_declined = [];
      }
      if (!jobRecord.candidates_declined.includes(number)) {
        jobRecord.candidates_declined.push(number);
      }
      // Remove the offer from offers_available.
      candidateData[position][number].offers_available = candidateData[
        position
      ][number].offers_available.filter((offer) => offer.company !== company);
    }

    // Write back the updated files.
    fs.writeFileSync(
      candidateFilePath,
      JSON.stringify(candidateData, null, 2),
      "utf8"
    );
    fs.writeFileSync(jdFilePath, JSON.stringify(jobDescData, null, 2), "utf8");

    return res.json({ message: "Offer response updated successfully." });
  } catch (error) {
    console.error("Error updating offer response:", error);
    return res.status(500).json({
      error: "An error occurred while updating the offer response.",
    });
  }
});

module.exports = router;
