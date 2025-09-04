require('dotenv').config();
const express = require('express');
const { serve } = require("inngest/express");
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { inngest, functions } = require('./api/inngest');
const qt = require('./api/qt');


const app = express();

// set trust proxy: 2 for DigitalOcean
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 2);
}

app.use(express.json());
app.use(cors());
app.use(cookieParser());

app.use('/api/inngest', serve({ client: inngest, functions }));

app.use('/qt', qt);

app.get('/', (req, res) => {
    res.send('Hello World');
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

