const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const PORT = 3001;

// Serve static files from the same directory
app.use(express.static(__dirname));

// Accept large image payloads
app.use(bodyParser.json({ limit: '10mb' }));

app.post('/predict', (req, res) => {
    const imageData = req.body.image;

    if (!imageData) {
        return res.status(400).json({ success: false, error: "No image provided" });
    }

    // Spawn the test_model.py script from the parent directory
    const pythonProcess = spawn('python', [path.join(__dirname, '..', 'test_model.py')], {
        cwd: path.join(__dirname, '..'), // Run from the parent dir so it finds model.py and weights
        env: {
            ...process.env,
            VIRTUAL_ENV: path.join(__dirname, '..', 'OneStroke_venv'),
            PATH: `${path.join(__dirname, '..', 'OneStroke_venv', 'bin')}:${process.env.PATH}`
        }
    });

    let outputData = '';
    let errorData = '';

    pythonProcess.stdout.on('data', (data) => {
        outputData += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
        errorData += data.toString();
        // Don't log normal PyTorch initialization warnings as errors unless they prevent successful exit
        console.error(`Python stderr: ${data}`);
    });

    pythonProcess.on('close', (code) => {
        if (code !== 0) {
            console.error(`Python process exited with code ${code}`);
            console.error(`Error output: ${errorData}`);
            return res.status(500).json({ success: false, error: 'Model execution failed', details: errorData });
        }

        try {
            // Find the JSON part of the output (ignoring any other stdout lines)
            const parts = outputData.split('\n');
            let result = null;
            for (let i = parts.length - 1; i >= 0; i--) {
                const line = parts[i].trim();
                if (line.startsWith('{')) {
                    result = JSON.parse(line);
                    break;
                }
            }

            if (result && result.success) {
                res.json(result);
            } else {
                res.status(500).json({ success: false, error: 'Invalid model output', raw: outputData });
            }
        } catch (e) {
            res.status(500).json({ success: false, error: 'Failed to parse model output', raw: outputData });
        }
    });

    // Send the base64 image data via stdin
    pythonProcess.stdin.write(imageData);
    pythonProcess.stdin.end();
});

app.listen(PORT, () => {
    console.log(`Test Tool Server running on http://localhost:${PORT}`);
});
