// OptiScan AI scanner wiring — captures the current camera frame and sends
// it to POST /api/analyze, then renders grade/confidence/heatmap.
// Loaded as its own <script> tag so it doesn't depend on or collide with
// whatever is already in js/dashboard-runtime.js.
(function () {
    const video = document.getElementById('scannerVideo');
    const analyzeBtn = document.getElementById('aiAnalyzeBtn');
    const output = document.getElementById('aiAnalysisOutput');
    const accessNotice = document.getElementById('diagnosisAccessNotice');
    const cataractTypeSelect = document.getElementById('cataractTypeSelect');
    const cataractTypeHint = document.getElementById('cataractTypeHint');

    if (!video || !analyzeBtn || !output) return; // scanner tab markup not present

    const CAPTURE_MODE_HINTS = {
        nuclear: 'Position for a direct slit-lamp image before capturing.',
        cortical: 'Switch to retro-illumination mode and center the pupil before capturing.',
        psc: 'Switch to retro-illumination mode and center the pupil before capturing.',
    };

    function getSelectedCataractType() {
        return cataractTypeSelect ? cataractTypeSelect.value : 'nuclear';
    }

    if (cataractTypeSelect && cataractTypeHint) {
        cataractTypeSelect.addEventListener('change', () => {
            cataractTypeHint.textContent = CAPTURE_MODE_HINTS[getSelectedCataractType()] || '';
        });
    }

    function captureFrameAsBase64() {
        if (window.optiscanLatestCapturedImage) {
            return window.optiscanLatestCapturedImage;
        }
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/png');
    }

    function renderResult(payload) {
        if (!payload.ok) {
            output.innerHTML = `<strong style="color:#991b1b;">Error:</strong> ${payload.error || 'Analysis failed.'}`;
            return;
        }

        const r = payload.result;

        if (r.is_eye === false) {
            output.innerHTML = `<strong>Result:</strong> ${r.grade_label} ` +
                `(screening confidence ${(r.screening_confidence * 100).toFixed(0)}%). Please re-capture with the eye centered in frame.`;
            return;
        }

        const confidenceText = (r.confidence !== null && r.confidence !== undefined)
            ? `${(r.confidence * 100).toFixed(0)}%`
            : 'n/a (deterministic measurement)';

        let html = `
            <strong>${r.grade_label}</strong><br>
            <span style="color:#6b7280; font-size:0.85rem;">
                Cataract type: ${r.cataract_type} &middot; Confidence: ${confidenceText}
            </span>
        `;

        if (payload.overlay) {
            html += `<div style="margin-top:0.75rem;">
                <img src="${payload.overlay}" alt="Explainability heatmap overlay"
                     style="max-width:100%; border-radius:8px; border:1px solid #e5e7eb;">
            </div>`;
        }

        output.innerHTML = html;
    }

    analyzeBtn.addEventListener('click', async () => {
        if (!window.optiscanLatestCapturedImage && !video.srcObject && !video.src) {
            output.innerHTML = '<strong>Start the camera first.</strong>';
            return;
        }

        analyzeBtn.disabled = true;
        output.innerHTML = 'Running AI scan&hellip;';

        try {
            const imageDataUrl = captureFrameAsBase64();
            const response = await fetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    image: imageDataUrl,
                    cataract_type: getSelectedCataractType(),
                }),
            });

            if (response.status === 403 && accessNotice) {
                accessNotice.style.display = 'block';
            }

            const payload = await response.json();
            renderResult(payload);
        } catch (err) {
            output.innerHTML = `<strong style="color:#991b1b;">Error:</strong> ${err.message}`;
        } finally {
            analyzeBtn.disabled = false;
        }
    });
})();