const express = require("express");
const router = express.Router();
const Expense = require("../models/Expense");
const ctrl = require("../controllers/fabricController");

// Test route
router.get("/", (req, res) => {
  res.send("Fabric API is working!");
});

// 🧵 Fabric Job routes
router.post("/job", ctrl.createJob);
router.post("/update-stage", ctrl.updateStage);
router.post("/scan", ctrl.scanJob);

// 🧾 PDF Bill routes
router.get("/bill/:fileName", ctrl.getBill);
router.get("/bill/by-job/:jobId", ctrl.getBillByJobId);
router.get("/generate-bill-link/:jobId", ctrl.getBillLink);
router.get("/billname/:jobId", ctrl.getBillNameByJobId);
router.post("/send-bill", ctrl.sendBillViaWhatsApp);

// 💸 Expense routes
router.post("/expense", ctrl.addExpense);
router.get("/expenses", ctrl.getExpenses);
router.get("/expenses/search", ctrl.searchExpenses);
router.delete("/expense/:id", async (req, res) => {
  try {
    await Expense.findByIdAndDelete(req.params.id);
    res.json({ message: "Expense deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
router.put("/expense/:id", async (req, res) => {
  try {
    const { amount } = req.body;
    const gst = amount * 0.05;
    await Expense.findByIdAndUpdate(req.params.id, { amount, gst });
    res.json({ message: "Updated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// 📊 Dashboard and Job Summary
router.get("/dashboard/stats", ctrl.getStats);
router.get("/dashboard/chart-data", ctrl.getChartData);
router.get("/summary/:jobId", ctrl.getJobSummaryWithExpenses);

// 🔧 Rate Config routes
router.post("/set-rates", ctrl.setRates);
router.get("/get-rates", ctrl.getRates);

// 🔍 Search Jobs
router.get("/jobs/search", ctrl.searchJobs);

module.exports = router;
