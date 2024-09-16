import puppeteer from 'puppeteer';
import axios from 'axios';
import { authApi } from './helpers/api';
import { updateBookingConversion } from './helpers/endpoints';

const url = `https://travelat60.site.traveltek.net/extranet/login.pl`;
(async () => {
	// Launch the browser and open a new blank page
	const browser = await puppeteer.launch({ headless: false });
	const page = await browser.newPage();

	const processBookings = async (bookingsData) => {
		const bookings = await Promise.all(await bookingsData.map(async booking => {
			const { referenceNumber } = booking;
			console.log(`Getting booking data for ${referenceNumber}...`);

			const bookingPage = await browser.newPage();
			await bookingPage.goto(booking.url, { timeout: 60000 });

			const bookingDetailsSelector = `table.detailstable > tbody > tr.detailsrow`;
			await bookingPage.waitForSelector(bookingDetailsSelector);

			const bookingData = await bookingPage.evaluate(async () => {
				const detailsTable = Array.from(document.querySelectorAll('table.detailstable > tbody > tr.detailsrow td'));

				const conversion_reference = detailsTable[1].textContent.trim();
				let bookingPayload = [], detail = null;
				
				bookingPayload.push({ label: 'traveltek_url', value: document.location.href });

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
				const portfoliosElements = elements.querySelectorAll('.portfolioelement');
				const elementsData = [];
				portfoliosElements.forEach((portfoliosElement, index) => {
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
					// console.log('Each element', { elementsData });
				});

				bookingPayload = {
					...bookingPayload.reduce((acc, { label, value }) => {
						acc[label] = value;
						return acc;
					}, {}),
					...{ elements: elementsData }
				};
				// console.log({ data: portfolioData });
	
				//	All travellers
				const bookingPassengerListSelector = `#financial-details + h3 + .listtable .listrow`;
				const bookingPassengerList = document.querySelectorAll(bookingPassengerListSelector);
				const passengers = [];
				bookingPassengerList.forEach((passenger, index) => {
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
						additional_data: bookingPayload
					}
				];
				// console.log(payload);
				return payload;//response;
			});

			//	Primary Booking Passenger
			const passengerSelector = `[href*='customer_view']`;
			await bookingPage.waitForSelector(passengerSelector);
			await bookingPage.click(passengerSelector);
			await bookingPage.waitForSelector(`.boxstyle1`);

			const passengerData = await bookingPage.evaluate(() => {
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
			
			bookingData[0].additional_data['primary_passenger'] = passengerData;
			// console.log({
			// 	...bookingData[0].additional_data,
			// });
		
			const response = await fetch('https://api-staging.startsat60.com/v2/holidays/conversions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					// 'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTIyNzMwOCwidXVpZCI6ImY0MWVlYmRkLWQ3YTAtNDEyNS04MjI3LTI0MzQ4NWZmZTM4NyIsImVtYWlsIjoic3RldmVuLndvb2xzdG9uQHN0YXJ0c2F0NjAuY29tIiwiaWF0IjoxNzEwMTM2MzY1LCJleHAiOjE3NDE2NzIzNjV9.nlVNZj9C7hEpcv-f5CXbLUvjdnhbS4K-f-WQrCWWwSw'
				},
				body: JSON.stringify(bookingData)
			})
			.then((response) => response.json());
	
			// console.log({
			// 	'API Response': response,
			// 	bookingData,
			// });

			await bookingPage.close();
			return {
				...bookingData,
				additional_data: {
					...bookingData['additional_data'],
					primary_passenger: passengerData 
				}
			};
		}));
	};

	const getBookings = async () => {

		const bookingsData = await page.evaluate(() => {
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

		await processBookings(bookingsData);
	};

	try {
		// Navigate the page to a URL
		await page.goto(url, { timeout: 60000 });

		// Set screen size
		await page.setViewport({width: 1920, height: 1080});

		// Type into search box
		const usernameSelector = `[name='username']`;
		await page.waitForSelector(usernameSelector);
		await page.type(`[name='username']`, `*****`, { delay: 10 });

		const passwordSelector = `[name='password']`;
		await page.waitForSelector(passwordSelector);
		await page.type(`[name='password']`, `*****`, { delay: 10 });

		const loginButtonSelector = `[type='submit']`;
		await page.waitForSelector(loginButtonSelector);
		await page.click(loginButtonSelector);

		// Wait for the results page to load and display the results
		// await page.waitForNavigation();

		await page.goto(`https://isell.traveltek.net/SAS/backoffice/boportfolios.pl`, { timeout: 60000 });
		// await page.waitForNavigation();

		const listBookingsSelector = `table.listtable > tbody > tr.listrow`;
		await page.waitForSelector(listBookingsSelector).then(async () => await getBookings());

		for (let i = 1; i <= 2; i++) {
			console.log(`Getting bookings for page ${i}...`);
			await page.goto(`https://isell.traveltek.net/SAS/backoffice/boportfolios.pl?start=${i*20}`, { timeout: 60000 });
			page.waitForNavigation({ timeout: 60000 });
			await page.waitForSelector(listBookingsSelector).then(async () => await getBookings());
		}

	} catch (error) {
		console.error('Error: ', error);
	}

	await browser.close();
})();