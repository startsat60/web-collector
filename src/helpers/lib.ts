export const sleep = (ms = 2000) => new Promise((r) => setTimeout(r, ms));

export const formatDate = (date?: Date) => {
	return date ? date.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
};

export const dateAdd = (date: Date, interval: number, period: 'days' | 'minutes' | 'hours') => {
	const newDate = new Date(date);
	switch (period) {
		case 'days':
			newDate.setDate(newDate.getDate() + interval);
			break;
		case 'hours':
			newDate.setHours(newDate.getHours() + interval);
			break;
		case 'minutes':
			newDate.setMinutes(newDate.getMinutes() + interval);
			break;
		default:
			break;
	}
	return newDate;
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
		'en-us', 
		{ 
			hour: '2-digit', 
			minute: '2-digit', 
			hour12: false 
		}
	);
}