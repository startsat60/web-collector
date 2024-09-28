import { mainmenu, welcome, ProcessType } from "./helpers/menu.js";
import { runDailyBookingProcessing, runHistoricalBookingProcessing } from "./services/traveltek.js";
import { createSpinner } from 'nanospinner';

(async () => {
	console.clear();
	await welcome();
	const processToRun = await mainmenu();

	switch (processToRun.process) {
		case ProcessType.DAILY:
			createSpinner('Running Daily Booking Processing...').start().stop();
			await runDailyBookingProcessing(
				{
					username: processToRun.credentials.username, 
					password: processToRun.credentials.password
				},
				true
			);
			break;
		case ProcessType.HISTORICAL:
			createSpinner('Running Historical Booking Processing...').start().stop();
			await runHistoricalBookingProcessing(
				{
					username: processToRun.credentials.username, 
					password: processToRun.credentials.password
				},
				processToRun.dateRange.startDate, 
				processToRun.dateRange.endDate);
			break;
		default:
			break;
	};
})();