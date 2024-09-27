import { runDailyBookingProcessing } from './services/traveltek';

(async () => {
	const currentDate = new Date().toISOString().split('T')[0];
	runDailyBookingProcessing();
	
	// const historicalDataStartDate = new Date(new Date().setDate(new Date().getDate() - 1)).toISOString().split('T')[0]; // 1 month ago
	// const historicalDataEndDate = new Date().toISOString().split('T')[0]; //'2024-09-25';
	// await Promise.all([
	// 	//doTodaysBookings(),
	// 	doHistoricalBookings(historicalDataStartDate, historicalDataEndDate),
	// 	timeout(60000),
	// ]);
})();