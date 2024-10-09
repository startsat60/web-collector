import inquirer from "inquirer";
import chalk from "chalk";
import { dateAdd, formatDate, sleep } from "./lib.js";
import { createSpinner } from "nanospinner";

export async function welcome() {
  console.log(`
  ${chalk.cyan(`
  ..####...######...####...#####...######...####........####...######........##.....####..
  .##........##....##..##..##..##....##....##..........##..##....##.........##.....##..##.
  ..####.....##....######..#####.....##.....####.......######....##........#####...##..##.
  .....##....##....##..##..##..##....##........##......##..##....##........##..##..##..##.
  ..####.....##....##..##..##..##....##.....####.......##..##....##.........####....####..
  `)}
  ${chalk.green('Welcome to the System Process Engine.')} 
  ${chalk.green('You will be prompted to select a process to run.')}
  `);
}

export enum ProcessType {
  DAILY = 'DAILY',
  HISTORICAL = 'HISTORICAL',
};

export const availableProcesses = [
  { value: ProcessType.DAILY, name: 'Today\'s Booking Processing (Runs in a loop)' },
  { value: ProcessType.HISTORICAL, name: 'Historical Booking Processing by Date Range' },
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

export const promptForCredentials = async (): Promise<{ username: string; password: string }> => {
  console.log(chalk.yellow('This process requires Traveltek credentials to continue.'));
  const credentialAnswers = await inquirer.prompt([
    {
      name: 'username',
      type: 'input',
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
  let credentials = null;
	const currentDate = formatDate();
	const day_0 = formatDate(new Date(process.env.HISTORICAL_PROCESSING_DAY_0)); //new Date(new Date().setDate(new Date().getDate() - 3)).toISOString().split('T')[0];
	let dateRange = { startDate: currentDate, endDate: currentDate };

  const answers = await inquirer.prompt({
    type: 'list',
    name: 'processToRun',
    message: 'Which process would you like to run?\n',
    choices: availableProcesses,
  });
  const spinner = createSpinner('Preparing...').start();
	await sleep(1000);
  spinner.stop();

  if (answers.processToRun === ProcessType.HISTORICAL || answers.processToRun === ProcessType.DAILY) {
    credentials = await promptForCredentials();

    if (answers.processToRun === ProcessType.HISTORICAL) {
      dateRange = await promptForDates(day_0, currentDate);
    };  
  }

  return {
    process: answers.processToRun,
    credentials,
    dateRange,
  };
};
