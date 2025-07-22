require("dotenv").config(); // 👈 TOP LINE: load env variables first

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");

const fabricRoutes = require("./Router/fabricRouter");

const app = express();

// ✅ Enable CORS
app.use(
  cors({
    origin: ["http://localhost:5173", "https://harshenterprise123.onrender.com"],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true,
  })
);
app.options("*", cors());

// Middleware
app.use(express.json());

// Publicly serve PDFs
app.use("/bills", express.static(path.join(__dirname, "bills")));

// MongoDB Connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ DB connected"))
  .catch(console.error);

// Routes
app.use("/api/fabric", fabricRoutes);

// Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
