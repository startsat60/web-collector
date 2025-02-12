import inquirer from "inquirer";
import { checkbox } from '@inquirer/prompts';
import { dateAdd, formatDate, sleep } from "../../helpers/lib.js";
import { createSpinner } from "nanospinner";
import { promptForCredentials, promptForDates } from "../../helpers/menu.js";
import { ProcessType } from "./lib.js";
import chalk from "chalk";
import { doLastProcessedBookings, processLiveBookings, runDailyBookingProcessing, runHistoricalBookingProcessing, runSpecificBookingProcessing } from "./index.js";

export const availableProcesses = [
  { value: ProcessType.DAILY, name: 'Live Traveltek Booking Processing (Runs in a loop)' },
  { value: ProcessType.HISTORICAL, name: 'Historical Booking Processing by Date Range (Sync)' },
  { value: ProcessType.SPECIFIC_BOOKING, name: 'Live Traveltek Processing by specific booking URL(s)' },
  { value: ProcessType.LIVE_DATE_RANGE, name: 'Live Traveltek Processing by date range' },
  { value: ProcessType.LAST_PROCESSED, name: 'Live Traveltek Processing by last processed date range' },
];

export const promptForBookingStatus = async () => {
  return await checkbox({
    message: `Select one or more booking statuses to process:`,
    choices: [
      { name: 'Cancelled', value: 'Cancelled' },
      { name: 'Changed', value: 'Changed', checked: true },
      { name: 'Complete', value: 'Complete' },
      { name: 'Open', value: 'Open', checked: true },
      { name: 'Query', value: 'Query', checked: true },
    ]    
  })
};

export const travelTekMenu = async () => {
	const currentDate = formatDate();
  let credentials = null,
    dateRange = { startDate: currentDate, endDate: currentDate },
    bookingUrlsDelimited = null,
    statuses = [];

  const day_0 = formatDate(new Date(process.env.HISTORICAL_PROCESSING_DAY_0)); //new Date(new Date().setDate(new Date().getDate() - 3)).toISOString().split('T')[0];

  const answers = await inquirer.prompt({
    type: 'list',
    name: 'processToRun',
    message: 'Which process would you like to run?\n',
    choices: availableProcesses,
  });
  const spinner = createSpinner('Preparing...').start();
	await sleep(1000);
  spinner.success({ text: `Preparing...Done` });

  if (answers.processToRun === ProcessType.HISTORICAL || 
    answers.processToRun === ProcessType.DAILY || 
    answers.processToRun === ProcessType.LIVE_DATE_RANGE || 
    answers.processToRun === ProcessType.LAST_PROCESSED
  ) {
    credentials = await promptForCredentials();
    if (answers.processToRun === ProcessType.DAILY || 
      answers.processToRun === ProcessType.LIVE_DATE_RANGE
    ) {
      dateRange = await promptForDates(currentDate, currentDate);
    };
    if (answers.processToRun === ProcessType.HISTORICAL) {
      dateRange = await promptForDates(day_0, currentDate);
    };
    if (answers.processToRun === ProcessType.LAST_PROCESSED) {
      dateRange = await promptForDates(day_0, formatDate(dateAdd(new Date(), -2, 'days')));
    };
  };

  if (answers.processToRun === ProcessType.HISTORICAL) {
    statuses = await promptForBookingStatus();
  };

  if (answers.processToRun === ProcessType.SPECIFIC_BOOKING) {
    credentials = await promptForCredentials();
    bookingUrlsDelimited = await inquirer.prompt([
      {
        name: 'bookingUrl',
        type: 'input',
        message: 'Enter the booking URLs separated by a comma (or single URL):',
        validate: (input) => {
          return input.length > 0 || 'URLs cannot be empty';
        },
      },
    ]);
  }

  return {
    process: answers.processToRun,
    credentials,
    dateRange,
    ...bookingUrlsDelimited,
    statuses,
  };
};

export const selectTraveltekProcess = async (processToRun) => {
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
    case ProcessType.LAST_PROCESSED:
      console.log(`\n${chalk.green('Running Historical Booking Processing for last processed date range...')}`);
      await doLastProcessedBookings({
        credentials: processToRun.credentials, 
        lastProcessedStartDate: processToRun.dateRange.startDate, 
        lastProcessedEndDate: processToRun.dateRange.endDate
      });
      console.log(`\n${chalk.green(`Completed historical processing of bookings for ${processToRun.dateRange.startDate} to ${processToRun.dateRange.endDate}.\n`)}`);
      break;
		default:
			break;
	};
};