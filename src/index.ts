import chalk from "chalk";
import { mainmenu, welcome } from "./helpers/menu.js";
import { processLiveBookings, runDailyBookingProcessing, runHistoricalBookingProcessing, runSpecificBookingProcessing } from "./services/traveltek.js";
import { ProcessType } from "./helpers/lib.js";

(async () => {
	console.clear();
	await welcome();
	const processToRun = await mainmenu();

	switch (processToRun.process) {
		case ProcessType.DAILY:
			console.log(`\n${chalk.green('Running Live Booking Processing...')}`);
			await runDailyBookingProcessing({
				credentials: {
					username: processToRun.credentials.username, 
					password: processToRun.credentials.password
				},
				startDate: processToRun.dateRange.startDate, 
				endDate: processToRun.dateRange.endDate,
				historicalProcessHasExecuted: true
			});
			break;
		case ProcessType.HISTORICAL:
			console.log(`\n${chalk.green('Running Historical Booking Processing...')}`);
			await runHistoricalBookingProcessing({
				credentials: processToRun.credentials,
				startDate: processToRun.dateRange.startDate, 
				endDate: processToRun.dateRange.endDate,
				statuses: processToRun.statuses,
			});
			break;
		case ProcessType.SPECIFIC_BOOKING:
			console.log(`\n${chalk.green('Running Specified Booking Processing...')}`);
			await runSpecificBookingProcessing({
				credentials: processToRun.credentials, 
				bookingUrls: processToRun.bookingUrl,
			});
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