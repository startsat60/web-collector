import { createSpinner } from "nanospinner";
import { launchBrowser, timeout } from "../../helpers/browser.js";
import 'dotenv/config';
import { Credentials, dateAdd, formatDate, formatTime, sleep } from "../../helpers/lib.js";
import chalk from "chalk";
import { Browser } from "puppeteer";
import { ProcessingStatus } from "./lib.js";

const loginUrl = process.env.TRAVELTEK_BOOKINGS_URL;
const bearerToken = process.env.BEARER_TOKEN;
const apiUrlBase = process.env.API_URL_BASE;
const processingStartTime = process.env.DAILY_PROCESSING_START_TIME || '09:00';
const processingEndTime = process.env.DAILY_PROCESSING_END_TIME || '21:30';
const defaultSleepTimeInMs = process.env.DEFAULT_SLEEP_TIME_IN_MS ? 
	Number(process.env.DEFAULT_SLEEP_TIME_IN_MS) : 
	300000;
let cachedCredentials: Credentials = null;

export interface Booking {
	referenceNumber?: string;
	url: string;
};

export const processBookings = async ({
	browser, 
	bookingsData, 
	showLogging = true
}: {
	browser: any, 
	bookingsData: Booking[], 
	showLogging?: boolean
}) => {
	let processBookingsSpinner = null,
		bookingReferenceNumber = bookingsData[0].referenceNumber ?? bookingsData[0].url,
		loggingMessage = `Processing ${bookingsData.length} bookings starting with ${bookingReferenceNumber}...`,
		errors = [];

	if (showLogging) {
		processBookingsSpinner = createSpinner(loggingMessage).start();
	};

	await Promise.all(await bookingsData.map(async (booking: Booking, i: number) => {
		try {
			// const { referenceNumber } = booking;
			// console.log(`Getting booking data for ${referenceNumber}...`);	
			let bookingPage = await browser.newPage();
			await bookingPage.goto(booking.url, { timeout: 300000 });
			let retryCounter = 0, maxRetries = 3, retryStatus = false;

			//	Retry this a few times to make sure auth is in place to mitigate later exceptions
			while (retryCounter < maxRetries) {
				await bookingPage.waitForSelector(`table.listtable > tbody > tr.listrow`, { timeout: 20000 })
				.then(() => retryStatus = true)
				.catch(async () => {
					await timeout(10000);
					await browser.close();
					browser = await launchBrowser();
					bookingPage = await browser.newPage();
					await doLogin(
						cachedCredentials ?? { username: process.env.TRAVELTEK_USERNAME, password: process.env.TRAVELTEK_PASSWORD }, 
						browser, 
						bookingPage
					);
					await bookingPage.goto(booking.url, { timeout: 120000 });		
					await timeout(10000);
					retryCounter++;
				});
	
				if (retryStatus) { retryStatus = false; retryCounter = 0; break; };
			};

			const bookingDetailsSelector = `table.detailstable > tbody > tr.detailsrow`;
			await bookingPage.waitForSelector(bookingDetailsSelector, { timeout: 20000 })
			.catch(async (e) => {
				const screenshot = `bookings_data_exception_${new Date().toISOString().replace(/:/g, '-')}.png`;
				await bookingPage.screenshot({
					path: `./src/services/traveltek/screenshots/${screenshot}`,
				});
				errors.push(`${booking.referenceNumber ?? booking.url} - Booking details data exception. Screenshot captured: ${screenshot}. Not updating. Message: ${e.message}`);
				await bookingPage.close();
			});
	
			const bookingData = await bookingPage.evaluate(async () => {
				let bookingPayload = [], detail = null;
				const booking_id = window.location.search.split('&').find((param) => param.includes('id')).split('=')[1];

				bookingPayload.push({ label: 'booking_id', value: booking_id });

				bookingPayload.push(
					{ label: 'destination_country', value: document.querySelector('[name="destcountryid"] option[selected]') ? 
						document.querySelector('[name="destcountryid"] option[selected]').textContent.trim() : '' },
				);
				bookingPayload.push(
					{ label: 'source', value: document.querySelector('[name="sourcecodeid"] option[selected]') ? 
						document.querySelector('[name="sourcecodeid"] option[selected]').textContent.trim() : '' },
				);
				bookingPayload.push(
					{ label: 'tickets_on_departure', value: document.querySelector('[name=ticketondemand]:checked') ?
						document.querySelector('[name=ticketondemand]:checked').getAttribute('value') : '' },
				);
				bookingPayload.push(
					{ label: 'atol_booking', value: document.querySelector('[name=atol]:checked') ? 
						document.querySelector('[name=atol]:checked').getAttribute('value') : '' },
					);
				bookingPayload.push(
					{ label: 'traveltek_url', value: document.location.href },
				);

				const detailsTable = Array.from(document.querySelectorAll('table.detailstable > tbody > tr.detailsrow td'));
				const conversion_reference = detailsTable[1].textContent.trim();
				
				if (detailsTable.length > 0) {	
					for (let i=0; i < detailsTable.length; i++) {
						const isEven = i % 2 == 0;
						const child = detailsTable[i];
						if (isEven) {
							detail = {
								...detail,
								label: child.textContent.trim().toLowerCase().replace(/\s+/g, '_')
							};
							continue;
						};
				
						if (!detail.label.trim()) {
							detail = null;
							continue;
						};
						
						bookingPayload.push({
							...detail,
							value: child.textContent.trim()
						});
						detail = null;
					}
				}
	
				const elements = document.querySelector('#elementlist');
				const portfoliosElements = elements?.querySelectorAll('.portfolioelement') ?? [];
				const elementsData = [];
				portfoliosElements.forEach((portfoliosElement) => {
					const portfolio = portfoliosElement.querySelectorAll('.listtable tr td');
					const hiddenDetails = portfoliosElement.querySelectorAll('& > div table tr td');
	
					const element = [
						{ label: 'provider', value: portfolio[6].textContent.trim() },
						{ label: 'provider_reference', value: portfolio[7].textContent.trim() },
						{ label: 'type', value: portfolio[3].textContent.trim() },
						{ label: 'net', value: portfolio[9].textContent.trim() },
						{ label: 'gross', value: portfolio[10].textContent.trim(), },
						{ label: hiddenDetails[0].textContent.trim().toLowerCase().replace(/\s+/g, '_'), value: hiddenDetails[1].textContent.trim(), },
						{ label: hiddenDetails[2].textContent.trim().toLowerCase().replace(/\s+/g, '_'), value: hiddenDetails[3].textContent.trim(), },
					];
					elementsData.push(element.reduce((acc, { label, value }) => {
						acc[label] = value;
						return acc;
					}, {}));
				});
	
				bookingPayload = {
					...bookingPayload.reduce((acc, { label, value }) => {
						acc[label] = value;
						return acc;
					}, {}),
					...{ elements: elementsData },
				};
	
				//	All travellers
				const bookingPassengerListSelector = `#financial-details + h3 + .listtable .listrow`;
				const bookingPassengerList = document.querySelectorAll(bookingPassengerListSelector);
				const passengers = [];
				bookingPassengerList.forEach((passenger) => {
					const passengerName = passenger.querySelector(`td:nth-child(2)`).textContent.trim();
					const passengerFare = passenger.querySelector(`td:nth-child(4)`).textContent.trim();
					const passengerPhone = passenger.querySelector(`td:nth-child(6)`).textContent.trim();
					const passengerEmail = passenger.querySelector(`td:nth-child(8)`).textContent.trim();
	
					passengers.push({
						name: passengerName,
						fare: passengerFare,
						phone: passengerPhone,
						email: passengerEmail,
					});
				});
				bookingPayload['passengers'] = passengers;
	
				const payload = [
					{
						conversion_reference,
						last_processed_date: new Date().toISOString(),
						additional_data: bookingPayload
					}
				];
				return payload;
			});
		
			//	Costings
			const costingsSelector = `[href*='costingbreakdown']`;
			await bookingPage.waitForSelector(costingsSelector, { timeout: 20000 });
			await bookingPage.click(costingsSelector);
			await bookingPage.waitForSelector(`[href*='bofinancial.pl?action=costing_add']`, { timeout: 20000 })
			.catch(async (e) => {
				while (retryCounter < maxRetries) {
					await bookingPage.waitForSelector(`[href*='bofinancial.pl?action=costing_add']`, { timeout: 20000 })
					.then(() => retryStatus = true)
					.catch(async () => {
						//	Wait for a few seconds before trying again - then create screenshot if max retries reached
						await timeout(10000);
						if (retryCounter === maxRetries) {
							const screenshot = `costings_data_exception_${booking.referenceNumber}_${new Date().toISOString().replace(/:/g, '-')}.png`;
							await bookingPage.screenshot({ path: `./src/services/traveltek/screenshots/${screenshot}`, });
							errors.push(`${booking.referenceNumber ?? booking.url} - Costings data exception. Screenshot captured: ${screenshot}. Not updating. Message: ${e.message}`);
							await bookingPage.close();
							throw e;
						}
						retryCounter++;
					});
		
					if (retryStatus) { retryStatus = false; retryCounter = 0; break; };
				};
			});

			const costingsData = await bookingPage.evaluate(() => {
				const costingsElement = document.querySelectorAll(`.listtable #rtotalrow td`);
				return {
					nett: costingsElement[5].textContent.trim(),
					gross: costingsElement[6].textContent.trim(),
					apportioned: costingsElement[7].textContent.trim(),
					unapportioned: costingsElement[8].textContent.trim(),
					extra_margin: costingsElement[9].textContent.trim(),
					commission: costingsElement[10].textContent.trim(),
					gst: costingsElement[11].textContent.trim(),
				};
			});
			bookingData[0].additional_data['total_costings'] = costingsData;
	
			//	Receipts
			const receiptsSelector = `[href*='receipts']`;
			await bookingPage.waitForSelector(receiptsSelector, { timeout: 20000 });
			await bookingPage.click(receiptsSelector);
			await bookingPage.waitForSelector(`[href*='cardpayment.pl']`, { timeout: 20000 })
			.catch(async (e) => {
				while (retryCounter < maxRetries) {
					await bookingPage.waitForSelector(`[href*='cardpayment.pl']`, { timeout: 20000 })
					.then(() => retryStatus = true)
					.catch(async () => {
						//	Wait for a few seconds before trying again - then create screenshot if max retries reached
						await timeout(10000);
						if (retryCounter === maxRetries) {
							const screenshot = `receipts_data_exception_${booking.referenceNumber}_${new Date().toISOString().replace(/:/g, '-')}.png`;
							await bookingPage.screenshot({ path: `./src/services/traveltek/screenshots/${screenshot}`, });
							errors.push(`${booking.referenceNumber ?? booking.url} - Receipts exception. Screenshot captured: ${screenshot}. Not updating. Message: ${e.message}`);
							await bookingPage.close();
							throw e;			
						}
						retryCounter++;
					});
		
					if (retryStatus) { retryStatus = false; retryCounter = 0; break; };
				};
			});
			const receiptsData = await bookingPage.evaluate(() => {
				const receipts = [];
				const receiptTables = document.querySelectorAll(`.listtable`);
				// if (receiptTables.length === 0) return receipts;

				for (let i=0; i < receiptTables.length; i++) {
					const firstRowCellSelector = receiptTables[i].querySelector(`.listheader td:nth-child(3)`);
					if (firstRowCellSelector && firstRowCellSelector.textContent.trim().toLowerCase() === 'reference') {
						//	Receipts
						const receiptsRows = receiptTables[i].querySelectorAll(`.listrow`);
						receiptsRows.forEach((receipt) => {
							receipts.push({
								id: receipt.querySelector(`td:nth-child(2)`).textContent.trim(),
								reference: receipt.querySelector(`td:nth-child(3)`).textContent.trim(),
								date: receipt.querySelector(`td:nth-child(4)`).textContent.trim(),
								payment_method: receipt.querySelector(`td:nth-child(5)`).textContent.trim(),
								total_value: receipt.querySelector(`td:nth-child(6)`).textContent.trim(),
								card_fee: receipt.querySelector(`td:nth-child(7)`).textContent.trim(),
								unapportioned_amount: receipt.querySelector(`td:nth-child(8)`).textContent.trim(),
								type: 'receipt',
							});
						});		
					};

					if (firstRowCellSelector && firstRowCellSelector.textContent.trim().toLowerCase() === 'reason') {
						//	Refunds
						const refundRows = receiptTables[i].querySelectorAll(`.listrow`);
						refundRows.forEach((refund) => {
							receipts.push({
								id: refund.querySelector(`td:nth-child(1)`).textContent.trim(),
								reference: refund.querySelector(`td:nth-child(3)`).textContent.trim(),
								date: refund.querySelector(`td:nth-child(2)`).textContent.trim(),
								payment_method: refund.querySelector(`td:nth-child(4)`).textContent.trim(),
								total_value: refund.querySelector(`td:nth-child(7)`).textContent.trim(),
								card_fee: null,
								unapportioned_amount: null,
								type: 'refund',
							});
						});
					};
				};
				return receipts;
			});
			bookingData[0].additional_data['receipts'] = receiptsData ?? [];
	
			const defaultCustomer = bookingData[0].additional_data['passengers'].find((passenger) => passenger.name === bookingData[0].additional_data['customer_name']);
			//	Primary Booking Passenger - this navigates to a new page so do all booking processing before this
			const passengerSelector = `[href*='customer_view']`;
			await bookingPage.waitForSelector(passengerSelector, { timeout: 10000 })
			.then(async () => {
				await bookingPage.click(passengerSelector);
				bookingData[0].additional_data['primary_passenger'] = 
					await bookingPage.waitForSelector(`.boxstyle1`, { timeout: 5000 })
					.then(async () => {
						//	Allow errors to fall out to the catch block
						return await bookingPage.evaluate(() => {
							const passengerContactDetailsElement = document.querySelectorAll(`h3 + table td`);
							const passengerName = passengerContactDetailsElement[1].textContent.trim();
							const passengerEmail = passengerContactDetailsElement[41].textContent.trim();
							const passengerPhone = passengerContactDetailsElement[31].textContent.trim();
							const passengerDOB = passengerContactDetailsElement[9].textContent.trim();
							const passengerPostcode = passengerContactDetailsElement[29].textContent.trim();
				
							return {
								name: passengerName,
								email: passengerEmail,
								phone: passengerPhone,
								dob: passengerDOB,
								postcode: passengerPostcode,
							};
						});
					})
			})
			.catch(async (e) => {
				//	Customer page load exception. Updating with default data.
				bookingData[0].additional_data['primary_passenger'] = {
					name: defaultCustomer ? defaultCustomer['name'] : 'Unknown',
					email: defaultCustomer ? defaultCustomer['email'] : '',
					phone: defaultCustomer ? defaultCustomer['phone'] : '',
					dob: '',
					postcode: '',
				};
			});

			await fetch(apiUrlBase, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${bearerToken}`
				},
				body: JSON.stringify(bookingData),
			})
			.then((response) => response.json())
			// .catch((e) => console.error(`Error updating booking data: ${e.message}`));
	
			await bookingPage.close();
			// console.log('API', { json: bookingData });
			return {
				...bookingData,
				additional_data: {
					...bookingData['additional_data'],
				}
			};
		} catch (err) {
			browser.currentPage && await browser.currentPage.close();
		}
	}))
	.catch(async (err) => {
		errors.push(`${bookingReferenceNumber} - Booking data exception. Not updating. Message: ${err.message}`);
		browser.currentPage && await browser.currentPage.close();
	})

	if (errors.length > 0) {
		processBookingsSpinner && processBookingsSpinner.error({ text: `${loggingMessage}Error` });
		console.log(`${chalk.red(`${errors.join('\n')}`)}`);
		return;
	}
	processBookingsSpinner && processBookingsSpinner.success({ text: `${loggingMessage}Done` });
};

export const getBookings = async (browser, page) => {
	const nextPageSelector = `.pages > .selpage + .page a:last-of-type`;
	let hasNextPage = await page.$(nextPageSelector) !== null;
	let isFirstPage = await page.$eval('.pages > .selpage', el => el.textContent) === '1';

	while (hasNextPage || isFirstPage) {
		const currentPageBookingsData = await page.evaluate(() => {
			const rows = Array.from(document.querySelectorAll(`table.listtable > tbody > tr.listrow`));
			return rows.map(row => {
				const columns = row.querySelectorAll(`td[width='10%']`);
				const bookingReference = columns[0].textContent.trim();
				const bookingUrl = columns[1].querySelector(`a`).href;
				return {
					referenceNumber: bookingReference,
					url: bookingUrl.replace('&shownote=1', '')
				};
			});
		});

		await processBookings({ browser, bookingsData: currentPageBookingsData });

		hasNextPage = await page.$(nextPageSelector) !== null;
		isFirstPage = false;
		if (hasNextPage) {
			await Promise.all([
				page.waitForNavigation({ waitUntil: 'networkidle0' }),
				page.click(nextPageSelector)
			]);
			// console.log('Navigating to next page...');
		}
	}
};

export const doLogin = async (credentials: Credentials, browser, page) => {
	cachedCredentials = credentials;
	let retryCounter = 1, maxRetries = 5, retryStatus = false;
	while (retryCounter <= maxRetries) {
		try {
			await page.goto(loginUrl, { timeout: 120000 });
			const usernameSelector = `[name='username']`;
			await page.waitForSelector(usernameSelector, { timeout: 20000 });
			await page.type(`[name='username']`, credentials.username, { delay: 10 });
		
			const passwordSelector = `[name='password']`;
			await page.waitForSelector(passwordSelector, { timeout: 20000 });
			await page.type(`[name='password']`, credentials.password, { delay: 10 });
			
			const loginButtonSelector = `[type='submit']`;
			await page.waitForSelector(loginButtonSelector, { timeout: 20000 });
			await page.click(loginButtonSelector);
			await page.evaluate(async () => {
				if (!document.querySelector(`input[name='username']`)) {
					//	Login page has not simply reloaded due to failure
					return true;
				}
				throw new Error(`Login page re-loaded. Trying again.`);
			})
			.then(() => retryStatus = true);

			if (retryStatus) break;
		} catch (error) {
			const waitTime = retryCounter*30000;
			console.log(`${chalk.gray(`Login attempt ${retryCounter} failed. ${(retryCounter <= maxRetries) ? `Waiting ${waitTime/1000}secs before retrying...` : ''}: ${error.message}`)}`);
			await timeout(retryCounter*30000).catch(() => {});
			browser && await browser.close().catch(() => {});
			browser = await launchBrowser().catch(() => {});
			browser.currentPage && await browser.currentPage.close().catch(() => {});
			page = await browser.newPage().catch(() => {});
			retryCounter++;
		}
	};
	return {
		browser,
		page,
		loggedIn: retryStatus
	};
};

export const processLiveBookings = async (credentials: Credentials, browser?: Browser, startDate?: string, endDate?: string) => {
	const reportStartDate = startDate ? new Date(startDate) : new Date();
	const reportEndDate = endDate ? new Date(endDate) : new Date();

	const reportStartDay = reportStartDate.getDate();
	const reportStartMonth = reportStartDate.getMonth()+1;
	const reportStartYear = reportStartDate.getFullYear();

	const reportEndDay = reportEndDate.getDate();
	const reportEndMonth = reportEndDate.getMonth()+1;
	const reportEndYear = reportEndDate.getFullYear();

	// Launch the browser and open a new blank page
	browser = browser ?? await launchBrowser();
	let page = await browser.newPage();

	try {
		const loginResult: { browser: Browser, page: any, loggedIn: boolean } = 
			await doLogin(
				credentials ?? cachedCredentials ?? { username: process.env.TRAVELTEK_USERNAME, password: process.env.TRAVELTEK_PASSWORD }, 
				browser, 
				page
			).then((result) => { 
				if (!result.loggedIn) { 
					console.log(`${chalk.red('Login failed. Cancelling execution.')}`); 
					process.exit(0); 
				} 
				return result; 
			});
		browser = loginResult.browser;
		page = loginResult.page;

		await page.goto(`https://isell.traveltek.net/SAS/backoffice/boportfolios.pl?
			reference=&firstname=&lastname=&tradingnameid=&datetype=created&
			startdate-day=${reportStartDay}&startdate-month=${reportStartMonth}&startdate-year=${reportStartYear}&
			enddate-day=${reportEndDay}&enddate-month=${reportEndMonth}&enddate-year=${reportEndYear}&
			postcode=&telephone=&createdby=&branch=&bookinguser=&holidaymakerid=&
			externalref=&elementtype=&suppliername=&supplierref=&status=&promocode=&
			affiliate=&bookingteamid=&bookingbranchid=&customstatusid=&sourcecodeid=&
			cruisevoyagecode=&from=&action=&submit=Search+Portfolios`, { timeout: 120000 });

		const listBookingsSelector = `table.listtable > tbody > tr.listrow`;
		if (await page.$(listBookingsSelector) === null) {
			console.log(`${chalk.red(`No bookings found between ${startDate} and ${endDate}.`)}`);
			return;
		}

		await page.waitForSelector(listBookingsSelector, { timeout: 20000 })
			.then(async () => await getBookings(browser, page))
			.catch(async (error) => {
				const screenshot = `no_bookings_${new Date().toISOString().replace(/:/g, '-')}.png`;
				await page.screenshot({
					path: `./src/services/traveltek/screenshots/${screenshot}`,
				});
				console.error(`Timeout occurred showing search results. It usually means no bookings were returned. Screenshot captured: ${screenshot}. Err: ${error.message}`);
			});
	} catch (error) {
		console.log(`${chalk.red(`General exception processing live bookings: ${error.message}`)}`);
	} finally {
		page && await page.close();
		browser && await browser.close();
	}
};

export const doHistoricalBookings = async ({
	credentials,
	historicalDataStartDate,
	historicalDataEndDate,
	statuses = [],
}: {
	credentials: Credentials, 
	historicalDataStartDate: string, 
	historicalDataEndDate: string, 
	statuses: string[],
}) => {
	// const fetchUrl = `${apiUrlBase}/search?last_processed_date_from=${historicalDataStartDate}&last_processed_date_to=${historicalDataEndDate}&departure_date_from=${new Date().toISOString().split('T')[0]}&booking_status=Changed&booking_status=Query&booking_status=Open&booking_status=Complete&booking_status=Cancelled&sort_by_order=created_date asc`;

	//	debugging
	const fetchUrl = `${apiUrlBase}/search?last_processed_date_from=${historicalDataStartDate}&last_processed_date_to=${historicalDataEndDate}&sort_by_order=created_date asc&${statuses.map(status => `booking_status=${status}`).join('&')}`;

	const existingBookings = await fetch(fetchUrl, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${bearerToken}`
		},
	})
	.then((response) => response.json())
	.then((response) => response.map(({ conversion_reference, traveltek_url }) => {
		return {
			referenceNumber: conversion_reference,
			url: traveltek_url
		}
	}))
	.catch((err) => {
		console.error(`Error fetching historical bookings: ${err.message}`);
		return [];
	});	

	if (existingBookings.length === 0) {
		console.log(`\nNo historical tasks between ${chalk.yellow(historicalDataStartDate)} and ${chalk.yellow(historicalDataEndDate)} to do. Exiting...`);
	}

	const startTime = new Date();
	console.log(`\nChecking and updating historical data from ${chalk.yellow(historicalDataStartDate)} to ${chalk.yellow(historicalDataEndDate)} and it looks like there are ${existingBookings.length} records to get.\nThis takes a while so let's mark the start time as ${startTime.toLocaleTimeString()}.`);
	console.log(`Syncing ${existingBookings.length} historical bookings...`);
	let processBookingsSpinner = null;
	const chunkSize = 200;
	const bookingsPerChunk = 20;
	const chunks = [];

	for (let i = 0; i < existingBookings.length; i += chunkSize) {
		chunks.push(existingBookings.slice(i, i + chunkSize));
	}

	if (chunks.length > 1) {
		console.log(`That's quite a few bookings so they will be processed in ${chunks.length} chunks.`);
	}
	
	for await (const chunk of chunks) {
		//	launch a new browser and login for each chunk
		let browser = await launchBrowser();
		let page = await browser.newPage();

		try {		
			const loginResult: { browser: Browser, page: any, loggedIn: boolean } = 
				await doLogin(
					credentials ?? cachedCredentials ?? { username: process.env.TRAVELTEK_USERNAME, password: process.env.TRAVELTEK_PASSWORD }, 
					browser, 
					page
				).then((result) => { 
					if (!result.loggedIn) { 
						console.log(`${chalk.red('Login failed. Cancelling execution.')}`); 
						process.exit(0); 
					} 
					return result; 
				});
			browser = loginResult.browser;
			page = loginResult.page;

			for (let i = 0; i < chunk.length; i += bookingsPerChunk) {
	
				const arrayOfPromises = [];
				for (let j = 0; j <= bookingsPerChunk && i + j < chunk.length; j++) {
					arrayOfPromises.push(await processBookings({ browser, bookingsData: [chunk[i + j]], showLogging: false }));
				}

				const loggingMessage = `Syncing records ${i + 1} - ${i + arrayOfPromises.length} of next ${chunk.length} historical bookings starting at ${chunk[i]?.referenceNumber}...`;
				processBookingsSpinner = createSpinner(loggingMessage).start();

				await Promise.all(arrayOfPromises)
				.then(() => {
					processBookingsSpinner && processBookingsSpinner.success({ text: `${loggingMessage}Done` });
				})
				.catch(async (e) => {
					page && await page.close();
					await browser.close();
					browser = await launchBrowser();
					page = await browser.newPage();
					const loginResult: { browser: Browser, page: any, loggedIn: boolean } = 
						await doLogin(
							credentials ?? cachedCredentials ?? { username: process.env.TRAVELTEK_USERNAME, password: process.env.TRAVELTEK_PASSWORD }, 
							browser, 
							page
						).then((result) => { 
							if (!result.loggedIn) { 
								processBookingsSpinner && processBookingsSpinner.error({ text: `${loggingMessage}Login failed. Cancelling execution.` });
								console.log(`${chalk.red('Login failed. Cancelling execution.')}`); 
								process.exit(0); 
							} 
							return result; 
						});
					browser = loginResult.browser;
					page = loginResult.page;	
				});
			}
		} catch (error) {
			processBookingsSpinner && processBookingsSpinner.error({ text: `Error: ${error.message}` });
		} finally {
			//	close browser between each chunk processing pass
			page && await page.close().catch(()=> {});
			await browser.close().catch(()=> {});
			const sleepTimeoutMs = 5000;
			console.log(`${chalk.yellow(`Finished chunk processing. Sleeping for ${sleepTimeoutMs/1000} seconds before continuing...`)}`);
			await sleep(sleepTimeoutMs);
		}
	};

	const endTime = new Date();
	console.log(`\nFinished checking and updating historical data. This processed bookings between ${chalk.yellow(historicalDataStartDate)} and ${chalk.yellow(historicalDataEndDate)} and took about ${parseInt(((endTime.getTime() - startTime.getTime())/1000/60).toString())} minutes.`);
};

export const doLastProcessedBookings = async ({
	credentials,
	lastProcessedStartDate,
	lastProcessedEndDate,
}: {
	credentials: Credentials, 
	lastProcessedStartDate: string, 
	lastProcessedEndDate: string, 
}) => {
	// const fetchUrl = `${apiUrlBase}/search?last_processed_date_from=${lastProcessedStartDate}&last_processed_date_to=${lastProcessedEndDate}&departure_date_from=${new Date().toISOString().split('T')[0]}&booking_status=Changed&booking_status=Query&booking_status=Open&booking_status=Complete&booking_status=Cancelled&sort_by_order=created_date asc`;

	//	debugging
	const fetchUrl = `${apiUrlBase}/search?last_processed_date_from=${lastProcessedStartDate}&last_processed_date_to=${lastProcessedEndDate}&sort_by_order=created_date asc`;

	const existingBookings = await fetch(fetchUrl, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${bearerToken}`
		},
	})
	.then((response) => response.json())
	.then((response) => response.map(({ conversion_reference, traveltek_url }) => {
		return {
			referenceNumber: conversion_reference,
			url: traveltek_url
		}
	}))
	.catch((err) => {
		console.error(`Error fetching historical bookings: ${err.message}`);
		return [];
	});	

	if (existingBookings.length === 0) {
		console.log(`\nNo historical tasks between ${chalk.yellow(lastProcessedStartDate)} and ${chalk.yellow(lastProcessedEndDate)} to do. Exiting...`);
		return [];
	}

	const startTime = new Date();
	console.log(`\nChecking and updating historical data from ${chalk.yellow(lastProcessedStartDate)} to ${chalk.yellow(lastProcessedEndDate)} and it looks like there are ${existingBookings.length} records to get.\nThis takes a while so let's mark the start time as ${startTime.toLocaleTimeString()}.`);
	console.log(`Syncing ${existingBookings.length} historical bookings...`);
	let processBookingsSpinner = null;
	const chunkSize = 200;
	const bookingsPerChunk = 20;
	const chunks = [];

	for (let i = 0; i < existingBookings.length; i += chunkSize) {
		chunks.push(existingBookings.slice(i, i + chunkSize));
	}

	if (chunks.length > 1) {
		console.log(`That's quite a few bookings so they will be processed in ${chunks.length} chunks.`);
	}
	
	for await (const chunk of chunks) {
		//	launch a new browser and login for each chunk
		let browser = await launchBrowser();
		let page = await browser.newPage();

		try {		
			const loginResult: { browser: Browser, page: any, loggedIn: boolean } = 
			await doLogin(
				credentials ?? cachedCredentials ?? { username: process.env.TRAVELTEK_USERNAME, password: process.env.TRAVELTEK_PASSWORD }, 
				browser, 
				page
			).then((result) => { 
				if (!result.loggedIn) { 
					console.log(`${chalk.red('Login failed. Cancelling execution.')}`); 
					process.exit(0); 
				} 
				return result; 
			});
			browser = loginResult.browser;
			page = loginResult.page;

			for (let i = 0; i < chunk.length; i += bookingsPerChunk) {
	
				const arrayOfPromises = [];
				for (let j = 0; j <= bookingsPerChunk && i + j < chunk.length; j++) {
					arrayOfPromises.push(await processBookings({ browser, bookingsData: [chunk[i + j]], showLogging: false }));
				}

				const loggingMessage = `Syncing records ${i + 1} - ${i + arrayOfPromises.length} of next ${chunk.length} historical bookings starting at ${chunk[i]?.referenceNumber}...`;
				processBookingsSpinner = createSpinner(loggingMessage).start();

				await Promise.all(arrayOfPromises);
				processBookingsSpinner && processBookingsSpinner.success({ text: `${loggingMessage}Done` });
			}
		} catch (error) {
			processBookingsSpinner && processBookingsSpinner.error({ text: `Error: ${error.message}` });
		} finally {
			//	close browser between each chunk processing pass
			page && await page.close();
			await browser.close();
			const sleepTimeoutMs = 5000;
			console.log(`${chalk.yellow(`Finished chunk processing. Sleeping for ${sleepTimeoutMs/1000} seconds before continuing...`)}`);
			await sleep(sleepTimeoutMs);
		}
	};

	const endTime = new Date();
	console.log(`\nFinished checking and updating historical data. This processed bookings between ${chalk.yellow(lastProcessedStartDate)} and ${chalk.yellow(lastProcessedEndDate)} and took about ${parseInt(((endTime.getTime() - startTime.getTime())/1000/60).toString())} minutes.`);
};

const dailyProcessingCanStart = (processingStartTime) => (new Date() >= new Date(`${formatDate()} ${processingStartTime}`));
const dailyProcessingHasEnded = (processingEndTime) => (new Date() >= new Date(`${formatDate()} ${processingEndTime}`));
const withinDailyProcessingWindow = () => (dailyProcessingCanStart(processingStartTime) && !dailyProcessingHasEnded(processingEndTime));

/**
 * Run the Traveltek daily booking routine.
 * This routine runs during the periods defined in the environment variables
 * @param credentials Traveltek credentials
 * @param historicalProcessHasExecuted Allows the historical process to be bypassed
 */
export const runDailyBookingProcessing = async ({
	credentials,
	startDate,
	endDate,
}: {
	credentials: Credentials, 
	startDate?: string, 
	endDate?: string, 
	historicalProcessHasExecuted?: boolean
}) => {
	const daysAgoToProcessDaily = (Number(process.env.DAYS_AGO_TO_PROCESS_IN_DAILY_PROCESS)) || 0;
	let processingStatus: ProcessingStatus | null | undefined = undefined,
		hibernationSpinner = null,
		runHistoricalProcessEvery = 10,	//	Every 10 iterations, process historical bookings
		runHistorialProcessCounter = 0;

	while (
		processingStatus === undefined || 
		processingStatus === null || 
		processingStatus === ProcessingStatus.IN_PROGRESS ||
		processingStatus === ProcessingStatus.SLEEPING || 
		processingStatus === ProcessingStatus.HIBERNATING
	) {
		//	check if the current time is within the processing hours on each iteration
		if (withinDailyProcessingWindow()) {
			processingStatus = ProcessingStatus.IN_PROGRESS;
			if (hibernationSpinner) {
				//	waking from hibernation so reset everything
				hibernationSpinner.stop();
				hibernationSpinner = null;
			};
			startDate = formatDate();
			endDate = formatDate();
			const browser = await launchBrowser();
			try {
				await processLiveBookings(credentials, browser, startDate, endDate);
				browser && await browser.close();

				console.log(`\nDaily processing completed for ${startDate} to ${endDate}.`);

				if (runHistorialProcessCounter <= runHistoricalProcessEvery) {
					runHistorialProcessCounter++;
				} else {
					const waitToProcessHistoryMessage = `Preparing to process bookings made in the last ${daysAgoToProcessDaily} days...`;
					const waitToProcessHistory = createSpinner(waitToProcessHistoryMessage).start();
					//	Wait for a few seconds before running again because Traveltek API is slow
					await timeout(15000);
					waitToProcessHistory.success({ text: `${waitToProcessHistoryMessage}Done` });

					//	live update bookings made in the n days before today (because today's have already been processed)
					await processLiveBookings(
						credentials,
						null,
						formatDate(dateAdd(new Date(), (-1*daysAgoToProcessDaily), 'days')), 
						formatDate(dateAdd(new Date(), -1, 'days'))
					);

					runHistorialProcessCounter = 0;
				}

				console.log(`Sleeping for ${defaultSleepTimeInMs/1000/60} minute(s) after processing bookings for ${startDate} to ${endDate}. Running again at ${formatTime(dateAdd(new Date(), (defaultSleepTimeInMs/1000/60), 'minutes'))}.\n`);
			} catch (err) {
				processingStatus === null;
				console.log(`${chalk.red(`General exception occurred processing daily bookings. Skipping this process and returning to sleep. Message: ${err.message}`)}`);
			} finally {
				browser && await browser.close();
				processingStatus = ProcessingStatus.SLEEPING;
				await timeout(defaultSleepTimeInMs);
			}
		} else {
			//	Daily processing out of hours, so process active historical records before hibernating
			if (processingStatus === ProcessingStatus.SLEEPING) {
				try {
					console.log(chalk.green(`Daily processing end time has passed. Active historical bookings will be processed now...`));
					await runHistoricalBookingProcessing({ 
						credentials,
						statuses: ['Changed', 'Query', 'Open'],
					 });
					//	Check if daily processing should begin again. If so, set status to sleeping so the loop can begin again. This will bypass the processing of cancelled and complete bookings
					processingStatus = withinDailyProcessingWindow() ?
						ProcessingStatus.SLEEPING : 
						ProcessingStatus.HIBERNATING;
				} catch (err) {
					processingStatus === null;
					console.log(`${chalk.red(`General exception occurred processing historical bookings while SLEEPING: ${err.message}`)}`);
				} finally {
					await timeout(defaultSleepTimeInMs);
				}
			} else if (processingStatus === ProcessingStatus.HIBERNATING) {
				//	Process cancelled and complete bookings before hibernating
				try {
					console.log(`\n${chalk.green(`Daily and active historical processing is complete. Complete historical bookings will be processed now...`)}`);
					await runHistoricalBookingProcessing({ 
						credentials,
						statuses: ['Complete'],
					 });

					console.log(`\n${chalk.green(`Daily, active and complete historical processing is complete. Cancelled historical bookings will be processed now...`)}`);
					await runHistoricalBookingProcessing({ 
						credentials,
						statuses: ['Cancelled'],
					 });

					//	Final cleanup looking for bookings that remain unprocessed before today
					console.log(`\n${chalk.green(`Daily, active, complete and cancelled historical processing is complete. Historical bookings that remain unprocessed will be processed now...`)}`);
					await doLastProcessedBookings({ 
						credentials,
						lastProcessedStartDate: process.env.HISTORICAL_PROCESSING_DAY_0 ? formatDate(new Date(process.env.HISTORICAL_PROCESSING_DAY_0)) : '2020-06-01',
						lastProcessedEndDate: formatDate(dateAdd(new Date(), -2, 'days')),
					});
 
					//	Reset the processing status to null so the loop can begin again when processing start time is reached
					processingStatus = null;
				} catch (err) {
					processingStatus === null;
					console.log(`${chalk.red(`General exception occurred processing historical bookings while HIBERNATING: ${err.message}`)}`);
				} finally {
					await timeout(defaultSleepTimeInMs);
				}
			} else {
				!hibernationSpinner && (hibernationSpinner = createSpinner(`${chalk.green(`Hibernating bookings processing until ${processingStartTime}...`)}`).start());
				processingStatus = processingStatus === undefined ? ProcessingStatus.HIBERNATING : null;
				await timeout(10000);
			}
		}
	}
};

export const runHistoricalBookingProcessing = async ({
	credentials, 
	startDate, 
	endDate, 
	statuses,
}: {
	credentials: Credentials, 
	startDate?: string, 
	endDate?: string, 
	statuses?: string[]
}) => {
	try {
		const historicalDataStartDate = startDate ?? 
		(process.env.HISTORICAL_PROCESSING_DAY_0 ? 
			formatDate(new Date(process.env.HISTORICAL_PROCESSING_DAY_0)) : 
			'2020-06-01'
		);	// Defaults back to day 1 or Traveltek data
		const historicalDataEndDate = endDate ?? formatDate();

		await doHistoricalBookings({ credentials, historicalDataStartDate, historicalDataEndDate, statuses });
	} catch (err) {
		console.log(`${chalk.red(`General exception occurred processing historical bookings: ${err.message}`)}`);
	} finally {
		//	Let's allow some time to pass before trying again
		await timeout(10000);		
	}
};

export const runSpecificBookingProcessing = async ({
	credentials, 
	bookingUrls
}: {
	credentials: Credentials, 
	bookingUrls: string
}) => {
	let browser = await launchBrowser();
	let page = await browser.newPage();

	try {
		const loginResult: { browser: Browser, page: any, loggedIn: boolean } = 
			await doLogin(
				credentials ?? cachedCredentials ?? { username: process.env.TRAVELTEK_USERNAME, password: process.env.TRAVELTEK_PASSWORD }, 
				browser, 
				page
			).then((result) => { 
				if (!result.loggedIn) { 
					console.log(`${chalk.red('Login failed. Cancelling execution.')}`); 
					process.exit(0); 
				} 
				return result; 
			});
		browser = loginResult.browser;
		page = loginResult.page;

		const bookingsData = bookingUrls.replace(/ /g, '').split(',').map(url => ({ url }));
		await processBookings({ browser, bookingsData, showLogging: true });
	} catch (error) {
		console.log(`${chalk.red(`General exception occurred processing specific historical bookings: ${error.message}`)}`);
		throw error;
	} finally {
		page && await page.close();
		browser && await browser.close();
	}
}