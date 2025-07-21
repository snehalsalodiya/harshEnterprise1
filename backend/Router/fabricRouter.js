
const express = require("express"); 

const Expense = require("../models/Expense");




const router = express.Router(); 
const ctrl = require("../controllers/fabricController");  


// Example route
router.get("/", (req, res) => {
  res.send("Fabric API is working!");
});







router.post("/job", ctrl.createJob); 
router.post("/update-stage", ctrl.updateStage); 
router.post("/scan", ctrl.scanJob);


router.get("/bill/:fileName", ctrl.getBill);

router.post("/expense", ctrl.addExpense); 
router.get("/expenses", ctrl.getExpenses); 
router.get("/expenses/search", ctrl.searchExpenses);
router.get("/jobs/search", ctrl.searchJobs);
router.get("/summary/:jobId", ctrl.getJobSummaryWithExpenses);  
router.post('/set-rates', ctrl.setRates);
router.get('/get-rates', ctrl.getRates);
router.get("/bill/by-job/:jobId", ctrl.getBillByJobId);



// Add to fabricRouter.js
router.delete('/expense/:id', async (req, res) => {
  try {
    await Expense.findByIdAndDelete(req.params.id);
    res.json({ message: 'Expense deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/expense/:id', async (req, res) => {
  const { amount } = req.body;
  const gst = amount * 0.05;
  await Expense.findByIdAndUpdate(req.params.id, { amount, gst });
  res.json({ message: 'Updated' });
});


router.get("/dashboard/stats", ctrl.getStats);
router.get("/dashboard/chart-data", ctrl.getChartData);




router.post("/send-bill", ctrl.sendPdfToWhatsApp);


module.exports = router;     