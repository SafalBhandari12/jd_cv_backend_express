# JD CV Backend Express & FastAPI (Cosine Similarity + Embeddings)

This repository contains a full-stack backend system comprised of two main components:

1. **Express Backend**  
   Provides REST endpoints for candidate and recruiter operations including candidate registration, CV/job description submission, feedback generation, login functionality, and recruiter decisions.

2. **FastAPI Service**  
   Provides endpoints for calculating cosine similarity between embeddings and generating text embeddings using the pre-trained [TechWolf/JobBERT-v2](https://huggingface.co/TechWolf/JobBERT-v2) model from SentenceTransformers.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Features](#features)
- [Architecture](#architecture)
- [Installation](#installation)
- [Usage](#usage)
- [API Endpoints](#api-endpoints)
- [Dependencies](#dependencies)
- [License](#license)
- [Contributing](#contributing)
- [Contact](#contact)

---

## Project Overview

This project is designed to facilitate job matching by comparing candidate CVs with job descriptions using advanced natural language processing techniques. The system extracts key details from candidate CVs and job descriptions, calculates similarity scores using cosine similarity and embeddings, and manages candidate recruitment workflows such as selection, rejection, and feedback.

The Express backend handles candidate and recruiter workflows while the FastAPI microservice handles embedding generation and similarity calculations.

---

## Features

- **Candidate Registration & Multi-Position CV Submission:**  
  Candidates can register and submit CVs for multiple positions. The system extracts skills, education, responsibilities, and work experience.

- **Job Description Registration:**  
  Recruiters can register job descriptions, which are then compared against candidate CVs for ranking.

- **Candidate & Recruiter Login:**  
  Separate login endpoints for candidates and recruiters ensure secure access.

- **Feedback Generation:**  
  The system provides actionable feedback for candidates based on comparisons with top candidates.

- **Cosine Similarity Calculation:**  
  Uses FastAPI with SentenceTransformers to compute cosine similarity between text embeddings.

- **Embedding Generation:**  
  Generates embeddings for any provided text using a state-of-the-art pre-trained model.

- **Notification & Offer Handling:**  
  Supports notifications for candidate updates and recruiter decisions on offers.

---

## Architecture

The system is divided into two major services:

- **Express Backend:**  
  Written in Node.js, it manages all candidate and recruiter related endpoints, file storage (JSON based), and integration with the FastAPI service for NLP tasks.

- **FastAPI Microservice:**  
  A Python-based service leveraging the SentenceTransformers library and TechWolf/JobBERT-v2 model to compute text embeddings and cosine similarity.

These two components can be deployed independently and communicate via HTTP requests.

---

## Installation

### Prerequisites

- **Node.js** (v14+ recommended)
- **Python** (v3.7+ recommended)
- **pip**

### Express Backend Setup

1. **Clone the repository:**

   ```bash
   git clone https://github.com/your_username/your_repository.git
   cd your_repository/jd_cv_backend_express
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Run the Express server:**

   ```bash
   npm start
   ```
   The server should start on your configured port (default might be 3000).

### FastAPI Service Setup

1. **Navigate to the FastAPI folder:**

   ```bash
   cd your_repository/fastAPI
   ```

2. **Create a virtual environment (optional but recommended):**

   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows use: venv\Scripts\activate
   ```

3. **Install required Python packages:**

   ```bash
   pip install fastapi uvicorn torch sentence-transformers
   ```

4. **Run the FastAPI server:**

   ```bash
   uvicorn main:app --reload
   ```
   The FastAPI server will be available at [http://127.0.0.1:8000](http://127.0.0.1:8000).

---

## Usage

- **Express Endpoints:**  
  Use tools like Postman or CURL to test the endpoints for candidate registration, job description submission, login, feedback, and notifications. The endpoints accept JSON payloads and perform file-based data storage.

- **FastAPI Endpoints:**  
  - **POST /cosine_similarity**: Send two embeddings (as lists of floats) and receive their cosine similarity.
  - **POST /get_embedding**: Send a text payload to generate and return its embedding.

Ensure that both services are running concurrently for full system functionality. The Express backend makes HTTP requests to the FastAPI endpoints as needed for embedding and similarity computations.

---

## API Endpoints

### Express Backend

- **Candidate Operations:**
  - `POST /register_candidate`: Register a new candidate with their CV and details.
  - `POST /candidate_cv`: Add a candidate’s CV for an additional position.
  - `POST /login_candidate`: Candidate login.

- **Job Description & Recruiter Operations:**
  - `POST /register_jd`: Register a new job description.
  - `POST /add_job_description_cv`: Add a job description for a new position.
  - `POST /login_jd`: Recruiter login.
  - `POST /uni_report`: Generate a report based on candidate university.
  - `POST /clear_notification_recruiter`: Clear notifications for recruiters.
  - `POST /recruiter_decision`: Process recruiter decision (select or reject candidate).
  - `POST /candidate_offer_response`: Process candidate response to an offer.

- **Notification & Feedback:**
  - `POST /clear_notification`: Clear notifications for a candidate.
  - `POST /feedback`: Generate actionable feedback for candidates.

### FastAPI Service

- **POST /cosine_similarity**  
  - **Input:** JSON payload with `embedding1` and `embedding2` (both lists of floats).  
  - **Output:** JSON with the cosine similarity value.

- **POST /get_embedding**  
  - **Input:** JSON payload with `text` (string).  
  - **Output:** JSON with the computed embedding (list of floats).

---

## Dependencies

### Express Backend Dependencies

- [Express](https://expressjs.com/)
- [fs](https://nodejs.org/api/fs.html)
- [path](https://nodejs.org/api/path.html)
- Custom helper modules for NLP operations

### FastAPI Dependencies

- [FastAPI](https://fastapi.tiangolo.com/)
- [uvicorn](https://www.uvicorn.org/)
- [torch](https://pytorch.org/)
- [sentence-transformers](https://www.sbert.net/)

---

## License

This project is licensed under the [MIT License](LICENSE).

---

## Contributing

Contributions are welcome! Feel free to fork the repository and submit a pull request. For major changes, please open an issue first to discuss what you would like to change.

---

## Contact

For any inquiries or issues, please open an issue in the GitHub repository or contact [safalbhandari069@gmail.com](mailto:safalbhandari069@gmail.com).

---

Happy coding!