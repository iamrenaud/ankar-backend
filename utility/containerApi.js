const axios = require('axios');

const containerApi = axios.create({
    baseURL: process.env.CONTAINER_API_URL,
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MAIN_API_KEY}`,
    },
});

module.exports = containerApi;