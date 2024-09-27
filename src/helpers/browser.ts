import puppeteer from "puppeteer";

export const launchBrowser = async () => {
	const browser = await puppeteer.launch({
		headless: true,
		args: ['--no-sandbox', '--disable-setuid-sandbox'],
	});
	return browser;
}

export const timeout = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));