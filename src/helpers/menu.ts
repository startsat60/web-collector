import inquirer from "inquirer";
import chalk from "chalk";
import { formatDate, sleep } from "./lib.js";
import { createSpinner } from "nanospinner";

export async function welcome() {
  console.log(`
  ${chalk.cyan(`
  ..####..######..####...#####..######..####.....####..######.....##....####..
  .##.......##...##..##..##..##...##...##.......##..##...##......##....##..##.
  ..####....##...######..#####....##....####....######...##.....#####..##..##.
  .....##...##...##..##..##..##...##.......##...##..##...##.....##..##.##..##.
  ..####....##...##..##..##...#...##....####....##..##...##......####...####..
  `)}
  ${chalk.green('Welcome to the System Process Engine.')} 
  ${chalk.green('You will be prompted to select a process to run.')}
  `);
}

export enum ProcessType {
  DAILY = 'DAILY',
  HISTORICAL = 'HISTORICAL',
  SPECIFIC_BOOKING = 'SPECIFIC_BOOKING',
  LIVE_DATE_RANGE = 'LIVE_DATE_RANGE',
};

export const availableProcesses = [
  { value: ProcessType.DAILY, name: 'Live Traveltek Booking Processing (Runs in a loop)' },
  { value: ProcessType.HISTORICAL, name: 'Historical Booking Processing by Date Range (Sync)' },
  { value: ProcessType.SPECIFIC_BOOKING, name: 'Live Traveltek Processing by specific booking URL(s)' },
  { value: ProcessType.LIVE_DATE_RANGE, name: 'Live Traveltek Processing by date range' },

];

export const promptForDates = async (startDate, endDate?): Promise<{ startDate: string; endDate: string }> => {
  console.log(chalk.yellow('Please enter a date range to continue.'));
  const dateAnswers = await inquirer.prompt([
    {
      name: 'startDate',
      type: 'input',
      message: 'Enter the start date (YYYY-MM-DD):',
      default: () => {
        return startDate;
      },
      validate: (input) => {
        const isValid = /^\d{4}-\d{2}-\d{2}$/.test(input);
        return isValid || 'Please enter a valid date in the format YYYY-MM-DD';
      },
        },
        {
      name: 'endDate',
      type: 'input',
      message: 'Enter the end date (YYYY-MM-DD):',
      default: () => {
        return endDate ?? formatDate();
      },
      validate: (input) => {
        const isValid = /^\d{4}-\d{2}-\d{2}$/.test(input);
        return isValid || 'Please enter a valid date in the format YYYY-MM-DD';
      },
    },
  ]);

  return {
    startDate: dateAnswers.startDate,
    endDate: dateAnswers.endDate,
  };
};

export const promptForCredentials = async (
  username?: string,
  password?: string,
): Promise<{ username: string; password: string }> => {
  console.log(chalk.yellow('This process requires Traveltek credentials to continue.'));
  const credentialAnswers = await inquirer.prompt([
    {
      name: 'username',
      type: 'input',
      default: username ?? process.env.TRAVELTEK_USERNAME,
      message: 'Enter your Traveltek username:',
      validate: (input) => {
        return input.length > 0 || 'Username cannot be empty';
      },
    },
    {
      name: 'password',
      type: 'password',
      message: 'Enter your Traveltek password:',
      mask: '*',
//      default: password ?? process.env.TRAVELTEK_PASSWORD,
      validate: (input) => {
        return input.length > 0 || 'Password cannot be empty';
      },
    },
  ]);

  return {
    username: credentialAnswers.username,
    password: credentialAnswers.password,
  };
};

export async function mainmenu() {
	const currentDate = formatDate();
  let credentials = null,
    dateRange = { startDate: currentDate, endDate: currentDate },
    bookingUrlsDelimited = null;

  const day_0 = formatDate(new Date(process.env.HISTORICAL_PROCESSING_DAY_0)); //new Date(new Date().setDate(new Date().getDate() - 3)).toISOString().split('T')[0];

  const answers = await inquirer.prompt({
    type: 'list',
    name: 'processToRun',
    message: 'Which process would you like to run?\n',
    choices: availableProcesses,
  });
  const spinner = createSpinner('Preparing...').start();
	await sleep(1000);
  spinner.stop();

  if (answers.processToRun === ProcessType.HISTORICAL || 
    answers.processToRun === ProcessType.DAILY || 
    answers.processToRun === ProcessType.LIVE_DATE_RANGE
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
  };
};
