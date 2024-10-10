import { mainmenu, welcome, ProcessType } from "./helpers/menu.js";
import { doLogin, processBookings, runDailyBookingProcessing, runHistoricalBookingProcessing, runSpecificBookingProcessing } from "./services/traveltek.js";
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
		case ProcessType.SPECIFIC_BOOKING:
			const { credentials, bookingUrl } = processToRun;
			await runSpecificBookingProcessing(credentials, bookingUrl);
			break;
		default:
			break;
	};
})();