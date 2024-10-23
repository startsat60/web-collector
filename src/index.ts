import chalk from "chalk";
import { mainmenu, welcome, ProcessType } from "./helpers/menu.js";
import { processLiveBookings, runDailyBookingProcessing, runHistoricalBookingProcessing, runSpecificBookingProcessing } from "./services/traveltek.js";

(async () => {
	console.clear();
	await welcome();
	const processToRun = await mainmenu();

	switch (processToRun.process) {
		case ProcessType.DAILY:
			console.log(`\n${chalk.green('Running Live Booking Processing...')}`);
			await runDailyBookingProcessing(
				{
					username: processToRun.credentials.username, 
					password: processToRun.credentials.password
				},
				processToRun.dateRange.startDate, 
				processToRun.dateRange.endDate,
				true
			);
			break;
		case ProcessType.HISTORICAL:
			console.log(`\n${chalk.green('Running Historical Booking Processing...')}`);
			await runHistoricalBookingProcessing(
				{
					username: processToRun.credentials.username, 
					password: processToRun.credentials.password
				},
				processToRun.dateRange.startDate, 
				processToRun.dateRange.endDate,
				processToRun.statuses,
			);
			break;
		case ProcessType.SPECIFIC_BOOKING:
			console.log(`\n${chalk.green('Running Specified Booking Processing...')}`);
			await runSpecificBookingProcessing(
				processToRun.credentials, 
				processToRun.bookingUrl
			);
			break;
		case ProcessType.LIVE_DATE_RANGE:
			console.log(`\n${chalk.green('Running Live Booking Processing for date range...')}`);
			await processLiveBookings(
				processToRun.credentials, 
				null, 
				processToRun.dateRange.startDate, 
				processToRun.dateRange.endDate
			);
			console.log(`\n${chalk.green(`Completed live processing of bookings for ${processToRun.dateRange.startDate} to ${processToRun.dateRange.endDate}.\n`)}`);
			break;
		default:
			break;
	};
})();