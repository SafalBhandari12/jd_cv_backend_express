// server.js
const express = require("express");
const path = require("path");
const http = require("http");
require("dotenv").config();

const cors = require("cors"); // Import CORS package
const userRouter = require("./routes/user");

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware to allow all CORS requests
app.use(cors());

// Middleware to parse JSON bodies
app.use(express.json());

// Mount the user routes under "/user"
app.use("/user", userRouter);

// Test route
app.get("/", (req, res) => {
  res.status(200).json({ msg: "Hello world!" });
});

// Start the server with error handling
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