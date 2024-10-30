import chalk from "chalk";

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

export interface Credentials {
	username: string;
	password: string;
};

export const sleep = (ms = 2000) => new Promise((r) => setTimeout(r, ms));

export const formatDate = (date?: Date) => {
	return date ? date.toLocaleString('sv', { 
			timeZoneName: 'short',
			hour12: false,
		}).split(' ')[0] : 
		new Date().toLocaleString('sv', { 
			timeZoneName: 'short',
			hour12: false,
		}).split(' ')[0];
};

export const dateAdd = (date: Date, interval: number, period: 'days' | 'minutes' | 'hours') => {
	switch (period) {
		case 'days':
			date.setDate(date.getDate() + interval);
			break;
		case 'hours':
			date.setHours(date.getHours() + interval);
			break;
		case 'minutes':
			date.setMinutes(date.getMinutes() + interval);
			break;
		default:
			break;
	}
	return date;
};

export const formatDateTime = (date?: Date) => {
	const formattedDate = formatDate(date);
	const formattedTime = formatTime(date);
	return new Date(`${formattedDate} ${formattedTime}`);
};

export const splitTimeIntoParts = (time: string) => {
	return time.split(':').map((d) => {
		return parseInt(d);
	});
};

export const formatTime = (date?: Date) => {
	date = date ?? new Date();
	return date.toLocaleTimeString(
		'sz', 
		{ 
			hour: '2-digit', 
			minute: '2-digit', 
			hour12: false 
		}
	).split(' ')[0];
}