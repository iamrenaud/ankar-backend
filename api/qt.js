const express = require('express');
const inngest = require('../lib/inngest');


const router = express.Router();

router.post('/', (req, res) => {
    const { message } = req.body;
    inngest.send({
        name: 'ankar.ai/say-hello',
        data: { message },
    });
    res.send('Message sent');
});

module.exports = router;