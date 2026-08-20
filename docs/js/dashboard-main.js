/* Full dashboard UI script extracted from inline HTML. */
let currentRole = 'guest';
let isAdminMode = false;
let isQualifiedProfessional = false;

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

async function logoutFromDashboard(event) {
    if (event && event.preventDefault) event.preventDefault();
    try {
        await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    } catch (error) {
        // ignore network errors and continue to clear local state
    }
    localStorage.removeItem('optiScanCurrentUser');
    window.location.href = 'OptiScan.html';
    return false;
}

document.addEventListener('DOMContentLoaded', async function () {
    const body = document.body;
    const settingsThemeSelect = document.getElementById('settingsThemeSelect');
    const settingsFontSelect = document.getElementById('settingsFontSelect');

    let currentTheme = localStorage.getItem('optiScanTheme') || 'light';
    function applyDashboardTheme(theme) {
        if (theme === 'dark') { body.classList.add('dark-mode'); }
        else { body.classList.remove('dark-mode'); }
        if (settingsThemeSelect) settingsThemeSelect.value = theme;
        localStorage.setItem('optiScanTheme', theme);
    }
    applyDashboardTheme(currentTheme);
    if (settingsThemeSelect) {
        settingsThemeSelect.addEventListener('change', (e) => applyDashboardTheme(e.target.value));
    }

    let currentFont = localStorage.getItem('optiScanFont') || 'font-md';
    function applyFontSize(fontSizeClass) {
        body.classList.remove('font-sm', 'font-md', 'font-lg');
        body.classList.add(fontSizeClass);
        if (settingsFontSelect) settingsFontSelect.value = fontSizeClass;
        localStorage.setItem('optiScanFont', fontSizeClass);
    }
    applyFontSize(currentFont);
    if (settingsFontSelect) {
        settingsFontSelect.addEventListener('change', (e) => applyFontSize(e.target.value));
    }

    const params = new URLSearchParams(window.location.search);
    const name = params.get('name');

    async function fetchSessionRole() {
        try {
            const response = await fetch('/api/me', { credentials: 'include' });
            if (!response.ok) return { authenticated: false, role: 'patient' };
            return await response.json();
        } catch (error) {
            return { authenticated: false, role: 'patient' };
        }
    }

    function getStoredUser() {
        try {
            return JSON.parse(localStorage.getItem('optiScanCurrentUser') || 'null');
        } catch (error) {
            return null;
        }
    }
    const storedUser = getStoredUser();
    const session = await fetchSessionRole();
    currentRole = session.role || 'patient';
    isAdminMode = Boolean(session.authenticated && currentRole === 'admin');
    isQualifiedProfessional = Boolean(session.authenticated && currentRole === 'medical-professional');
    if (!session.authenticated) {
        currentRole = 'guest';
        isAdminMode = false;
        isQualifiedProfessional = false;
    }

    const heading = document.getElementById('welcome-heading');
    const logoutLink = document.getElementById('logoutLink');
    const profileNameInput = document.getElementById('profile-name-input');
    const profileRoleBadge = document.getElementById('profile-role');
    const profileBirthdateInput = document.getElementById('profile-birthdate');
    const profileAgeInput = document.getElementById('profile-age');
    const profileHistoryInput = document.getElementById('profile-history');
    const saveProfileButton = document.getElementById('saveProfileBtn');
    
    const chatForm = document.getElementById('chatForm');
    const chatInput = document.getElementById('chatInput');
    const chatWindow = document.getElementById('chatWindow');
    const chatSidebar = document.getElementById('chatSidebar');
    const appointmentCenter = document.getElementById('appointmentCenter');
    const homeRoleSummary = document.getElementById('homeRoleSummary');
    const profilePreferredDoctorSelect = document.getElementById('profile-preferred-doctor');
    const chatAttachmentBtn = document.getElementById('chatAttachmentBtn');
    const adminTabBtn = document.getElementById('adminTabBtn');
    const chatAttachmentFile = document.getElementById('chatAttachmentFile');
    const chatAttachmentLabel = document.getElementById('chatAttachmentLabel');
    const chatContactName = document.getElementById('chatContactName');
    const replyPreview = document.getElementById('replyPreview');
    const replyPreviewText = document.getElementById('replyPreviewText');
    const cancelReplyButton = document.getElementById('cancelReplyBtn');
    const sidebarPanelHeader = document.getElementById('sidebarPanelHeader');
    const chatTerminalTitle = document.getElementById('chatTerminalTitle');
    const chatTerminalSubtitle = document.getElementById('chatTerminalSubtitle');
    const careTabButton = document.getElementById('careTabBtn');
    const carePatientList = document.getElementById('carePatientList');
    const carePatientName = document.getElementById('carePatientName');
    const carePatientProfile = document.getElementById('carePatientProfile');
    const careChatWindow = document.getElementById('careChatWindow');
    const careChatForm = document.getElementById('careChatForm');
    const careChatInput = document.getElementById('careChatInput');

    let selectedChatId = null; 
    let replyTarget = null;
    let selectedCarePatient = null;
    let pendingChatAttachment = null;
    const appointmentState = { doctorEmail: '', date: '', time: '', mode: 'async' };

    function isGuestUser() {
        return currentRole === 'guest';
    }

    function updateRoleUI() {
        if (homeRoleSummary) {
            let text = 'Your dashboard adapts to your role.';
            if (currentRole === 'guest') {
                text = 'Guest access: explore information, the scanner, and read-only summaries. Sign in or register to unlock patient booking and consultation features.';
            } else if (currentRole === 'patient') {
                text = 'Patient access: book appointments, chat with your care team, and manage your profile.';
            } else if (currentRole === 'medical-professional') {
                text = 'Doctor access: review assigned patients and manage consultations.';
            } else if (currentRole === 'admin') {
                text = 'Admin access: manage users, appointments, and system settings.';
            }
            homeRoleSummary.textContent = text;
        }
        if (careTabButton) {
            careTabButton.hidden = !(currentRole === 'medical-professional' || isAdminMode);
        }
    }

    function getDoctorDirectory() {
        try {
            const allUsers = JSON.parse(localStorage.getItem('optiScanUsers') || '[]');
            const doctors = [];
            (Array.isArray(allUsers) ? allUsers : []).forEach(function (user) {
                if ((user.role || '').toLowerCase() !== 'medical-professional') return;
                if (!user.isQualified && !(user.qualifications || '').trim()) return;
                const profileKey = 'optiScanProfile_' + btoa(user.email || '');
                const savedProfile = JSON.parse(localStorage.getItem(profileKey) || '{}');
                doctors.push({
                    name: savedProfile.name || user.name || 'Dr. Unknown',
                    qualifications: savedProfile.qualifications || user.qualifications || '',
                    hospital: savedProfile.hospital || '',
                    location: savedProfile.location || '',
                    email: savedProfile.doctorEmail || savedProfile.email || user.email || '',
                    phone: savedProfile.doctorPhone || savedProfile.phone || ''
                });
            });
            return doctors;
        } catch (error) {
            return [];
        }
    }

    function renderDoctorDirectory() {
        const container = document.getElementById('doctorListHome');
        if (!container) return;
        const doctors = getDoctorDirectory();
        container.innerHTML = '';
        if (!doctors.length) {
            container.innerHTML = '<p>No verified doctors available yet.</p>';
            return;
        }
        doctors.forEach(function (doctor) {
            const card = document.createElement('div');
            card.style.cssText = 'padding: 0.8rem; border: 1px solid #e5e7eb; border-radius: 8px; background: #f9fafb; margin-bottom:0.5rem;';

            const nameEl = document.createElement('strong');
            nameEl.style.cssText = 'color:#800020; display:block; margin-bottom:0.2rem;';
            nameEl.textContent = doctor.name || 'Dr. Unknown';
            card.appendChild(nameEl);

            const qualificationsEl = document.createElement('div');
            qualificationsEl.style.cssText = 'font-size:0.9rem; color:#4b5563;';
            qualificationsEl.textContent = doctor.qualifications || 'Specialist';
            card.appendChild(qualificationsEl);

            const hospitalEl = document.createElement('div');
            hospitalEl.style.cssText = 'font-size:0.9rem; color:#4b5563;';
            hospitalEl.textContent = doctor.hospital || 'Hospital pending';
            card.appendChild(hospitalEl);

            const locationEl = document.createElement('div');
            locationEl.style.cssText = 'font-size:0.85rem; color:#6b7280;';
            locationEl.textContent = doctor.location || 'Location pending';
            card.appendChild(locationEl);

            const emailEl = document.createElement('div');
            emailEl.style.cssText = 'font-size:0.84rem; color:#800020; margin-top:0.2rem;';
            const emailLabel = document.createElement('strong');
            emailLabel.textContent = 'Email:';
            emailEl.appendChild(emailLabel);
            emailEl.appendChild(document.createTextNode(' ' + (doctor.email || 'Not provided')));
            card.appendChild(emailEl);

            container.appendChild(card);
        });
    }

    document.addEventListener('click', () => closeAllDropdowns());

    const userSuffix = storedUser && storedUser.email ? '_' + btoa(storedUser.email) : '';
    const profileStorageKey = 'optiScanProfile' + userSuffix;

    const defaultProfile = {
        name: name || (storedUser ? storedUser.name : 'Guest'),
        birthdate: (storedUser && storedUser.birthdate ? storedUser.birthdate : ''),
        age: '',
        medicalHistory: isAdminMode ? 'Root access cleared.' : 'No major complications reported.',
        qualifications: '',
        hospital: '',
        location: '',
        doctorEmail: '',
        doctorPhone: '',
        preferredDoctorEmail: '',
        photo: ''
    };

    function calculateAge(birthdate) {
        if (!birthdate) return '';
        const birth = new Date(birthdate);
        const today = new Date();
        let age = today.getFullYear() - birth.getFullYear();
        if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age--;
        return age;
    }

    const homeStartScannerBtn = document.getElementById('homeStartScannerBtn');
    const homeOpenChatsBtn = document.getElementById('homeOpenChatsBtn');
    const homeUpdateProfileBtn = document.getElementById('homeUpdateProfileBtn');
    const homeBookApptBtn = document.getElementById('homeBookApptBtn');

    if (homeStartScannerBtn) {
        homeStartScannerBtn.addEventListener('click', function () { showTab('scanner'); });
    }
    if (homeOpenChatsBtn) {
        homeOpenChatsBtn.addEventListener('click', function () { showTab('chats'); });
    }
    if (homeUpdateProfileBtn) {
        homeUpdateProfileBtn.addEventListener('click', function () { showTab('profile'); });
    }
    if (homeBookApptBtn) {
        homeBookApptBtn.addEventListener('click', function () { showTab('home'); renderAppointmentCenter(); });
    }

    let profile = Object.assign({}, defaultProfile, JSON.parse(localStorage.getItem(profileStorageKey) || '{}'));
    if (profile.birthdate && !profile.age) profile.age = calculateAge(profile.birthdate);

    const normalizedProfileName = (profile.name || '').trim();
    if (normalizedProfileName && normalizedProfileName.toLowerCase() !== 'guest' && !isAdminMode && !isDoctorProfile && currentRole === 'patient') {
        ensurePatientRecord(normalizedProfileName);
    }
    
    if (heading) {
        const roleLabel = currentRole === 'medical-professional'
            ? (isQualifiedProfessional ? 'Medical Professional' : 'Medical Professional (Pending Qualification)')
            : (currentRole === 'admin' ? 'Administrator' : 'Patient');
        heading.textContent = `Welcome, ${profile.name} (${roleLabel})!`;
    }
    if (profileNameInput) profileNameInput.value = (profile.name === 'Guest') ? '' : profile.name;
    if (profileBirthdateInput) profileBirthdateInput.value = profile.birthdate;
    if (profileAgeInput) profileAgeInput.value = profile.age;
    if (profileHistoryInput) profileHistoryInput.value = profile.medicalHistory;
    if (profileRoleBadge) {
        profileRoleBadge.textContent = currentRole === 'medical-professional'
            ? (isQualifiedProfessional ? 'Medical Professional (Qualified)' : 'Medical Professional (Pending Qualification)')
            : (currentRole === 'admin' ? 'Administrator' : 'Patient');
    }

    function renderPreferredDoctorOptions() {
        if (!profilePreferredDoctorSelect) return;
        const doctors = getDoctorDirectory();
        const currentValue = profile.preferredDoctorEmail || '';
        profilePreferredDoctorSelect.innerHTML = '<option value="">No preferred doctor</option>';
        doctors.forEach(function (doctor) {
            const option = document.createElement('option');
            option.value = doctor.email || '';
            option.textContent = doctor.name || 'Doctor';
            if (doctor.email === currentValue) option.selected = true;
            profilePreferredDoctorSelect.appendChild(option);
        });
        profilePreferredDoctorSelect.value = currentValue;
    }

    if (profileBirthdateInput) {
        profileBirthdateInput.addEventListener('change', () => {
            profile.age = calculateAge(profileBirthdateInput.value);
            if (profileAgeInput) profileAgeInput.value = profile.age;
        });
    }

    if (profilePreferredDoctorSelect) {
        profilePreferredDoctorSelect.addEventListener('change', function () {
            profile.preferredDoctorEmail = profilePreferredDoctorSelect.value;
        });
    }

    if (saveProfileButton) {
        saveProfileButton.addEventListener('click', () => {
            profile.name = profileNameInput.value.trim();
            profile.birthdate = profileBirthdateInput.value;
            profile.age = profileAgeInput.value.trim();
            profile.medicalHistory = profileHistoryInput.value;
            profile.preferredDoctorEmail = profilePreferredDoctorSelect ? profilePreferredDoctorSelect.value : profile.preferredDoctorEmail;
            localStorage.setItem(profileStorageKey, JSON.stringify(profile));
            ensurePatientRecord(profile.name);
            renderPreferredDoctorOptions();
            alert('Profile configuration updated successfully.');
        });
    }

    function getAppointmentStore() {
        try {
            return JSON.parse(localStorage.getItem('optiScanAppointments') || '[]');
        } catch (error) {
            return [];
        }
    }

    function saveAppointmentStore(store) {
        localStorage.setItem('optiScanAppointments', JSON.stringify(store));
    }

    function getAvailabilityStore() {
        try {
            return JSON.parse(localStorage.getItem('optiScanDoctorAvailability') || '[]');
        } catch (error) {
            return [];
        }
    }

    function saveAvailabilityStore(store) {
        localStorage.setItem('optiScanDoctorAvailability', JSON.stringify(store));
    }

    function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = function (event) {
                resolve(event.target.result || '');
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    function buildMessageBody(message) {
        const body = document.createElement('div');
        body.style.display = 'flex';
        body.style.flexDirection = 'column';
        body.style.gap = '0.35rem';
        if (message.text) {
            const textBlock = document.createElement('div');
            textBlock.textContent = message.text;
            body.appendChild(textBlock);
        }
        if (message.link) {
            const linkBlock = document.createElement('a');
            linkBlock.href = message.link.startsWith('http') ? message.link : 'https://' + message.link;
            linkBlock.target = '_blank';
            linkBlock.rel = 'noopener noreferrer';
            linkBlock.textContent = message.link;
            linkBlock.style.color = '#bfdbfe';
            linkBlock.style.textDecoration = 'underline';
            body.appendChild(linkBlock);
        }
        if (message.attachment) {
            const attachment = message.attachment;
            if (attachment.type === 'image') {
                const image = document.createElement('img');
                image.src = attachment.dataUrl;
                image.alt = attachment.name || 'Shared image';
                image.style.maxWidth = '220px';
                image.style.borderRadius = '8px';
                body.appendChild(image);
            } else if (attachment.type === 'video') {
                const video = document.createElement('video');
                video.src = attachment.dataUrl;
                video.controls = true;
                video.preload = 'metadata';
                video.style.maxWidth = '220px';
                video.style.borderRadius = '8px';
                body.appendChild(video);
            } else {
                const fileLink = document.createElement('a');
                fileLink.href = attachment.dataUrl;
                fileLink.target = '_blank';
                fileLink.rel = 'noopener noreferrer';
                fileLink.textContent = attachment.name || 'Shared file';
                fileLink.style.color = '#bfdbfe';
                fileLink.style.textDecoration = 'underline';
                body.appendChild(fileLink);
            }
        }
        return body;
    }

    function renderAppointmentCenter() {
        if (!appointmentCenter) return;
        const appointments = getAppointmentStore();
        const availability = getAvailabilityStore();
        const doctors = getDoctorDirectory();
        if (currentRole === 'guest') {
            appointmentCenter.innerHTML = `
                <div class="appointment-card">
                    <strong>Guest access only</strong>
                    <p>Sign in as a registered patient to request appointments, select a doctor, and chat with your care team.</p>
                </div>
            `;
            return;
        }
        const isDoctorRole = currentRole === 'medical-professional' && isQualifiedProfessional;
        const doctorOptions = doctors.map(function (doctor) {
            return `<option value="${escapeHtml(doctor.email || '')}"${(appointmentState.doctorEmail || profile.preferredDoctorEmail || '') === (doctor.email || '') ? ' selected' : ''}>${escapeHtml(doctor.name || 'Doctor')}</option>`;
        }).join('');
        const upcomingDays = Array.from({ length: 7 }, function (_, index) {
            const date = new Date();
            date.setDate(date.getDate() + index);
            const value = date.toISOString().split('T')[0];
            const matches = availability.filter(function (entry) {
                return entry.doctorEmail === (appointmentState.doctorEmail || profile.preferredDoctorEmail || '') && entry.date === value;
            });
            const hasSlots = matches.some(function (entry) {
                return Array.isArray(entry.times) && entry.times.length;
            });
            return `<button type="button" class="day-pill${appointmentState.date === value ? ' active' : ''}${hasSlots ? ' available' : ''}" data-date="${value}">${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}</button>`;
        }).join('');
        const selectedAvailability = availability.filter(function (entry) {
            return entry.doctorEmail === (appointmentState.doctorEmail || profile.preferredDoctorEmail || '') && entry.date === appointmentState.date;
        });
        const slotButtons = selectedAvailability.length ? selectedAvailability.flatMap(function (entry) {
            return (entry.times || []).map(function (time) {
                const safeTime = escapeHtml(time || '');
                return `<button type="button" class="slot-chip${appointmentState.time === time ? ' active' : ''}" data-time="${safeTime}">${safeTime}</button>`;
            });
        }).join('') : '<p style="margin:0; color:#6b7280;">No availability is published for this date yet.</p>';
        const userAppointments = isDoctorRole
            ? appointments.filter(function (entry) { return (entry.doctorEmail || '').toLowerCase() === (getCurrentUserEmail() || '').toLowerCase(); })
            : appointments.filter(function (entry) { return (entry.patientEmail || '').toLowerCase() === (getCurrentUserEmail() || '').toLowerCase(); });
        const appointmentsMarkup = userAppointments.length ? userAppointments.map(function (entry) {
            const status = (entry.status || 'pending').toLowerCase();
            const stableStatus = status === 'pending' || status === 'confirmed' || status === 'cancelled' ? status : 'pending';
            const action = isDoctorRole && stableStatus === 'pending'
                ? `<button type="button" class="care-patient-accept accept-appointment-btn" data-appointment-id="${escapeHtml(entry.id || '')}">Accept</button>`
                : '';
            return `<div class="appointment-request ${stableStatus}"><div><strong>${escapeHtml(entry.patientName || 'Patient')}</strong><br><span style="font-size:0.82rem; color:#6b7280;">${escapeHtml(entry.date)} at ${escapeHtml(entry.time)} • ${escapeHtml(entry.mode === 'sync' ? 'Chat-based' : 'Asynchronous')}</span><br><span style="font-size:0.8rem; color:#800020;">Status: ${escapeHtml(stableStatus)}</span></div>${action}</div>`;
        }).join('') : '<p style="margin:0; color:#6b7280;">No appointments yet.</p>';
        const doctorAvailabilityMarkup = isDoctorRole ? availability.filter(function (entry) { return (entry.doctorEmail || '').toLowerCase() === (getCurrentUserEmail() || '').toLowerCase(); }).map(function (entry) { return `<div style="padding:0.6rem 0.7rem; border:1px solid #e5e7eb; border-radius:8px; background:#ffffff;">${escapeHtml(entry.date)} — ${escapeHtml((entry.times || []).join(', '))}</div>`; }).join('') : '';
        appointmentCenter.innerHTML = `
            <div style="display:grid; gap:0.9rem;">
                <div class="appointment-card">
                    <div style="display:flex; justify-content:space-between; gap:0.75rem; align-items:center; flex-wrap:wrap;">
                        <div>
                            <strong>${isDoctorRole ? 'Your availability board' : 'Book a consultation'}</strong>
                            <div style="font-size:0.88rem; color:#6b7280;">${isDoctorRole ? 'Publish dates so patients can request a consultation.' : 'Choose a specialist and book a visit.'}</div>
                        </div>
                        ${isDoctorRole ? '' : `<select id="appointmentDoctorSelect" style="padding:0.5rem; border:1px solid #cbd5e1; border-radius:6px; min-width:220px;">${doctorOptions}</select>`}
                    </div>
                    ${isDoctorRole ? `<div style="display:flex; flex-direction:column; gap:0.4rem;"><label style="font-weight:600;">Add a date</label><div style="display:flex; gap:0.5rem; flex-wrap:wrap;"><input type="date" id="doctorAvailabilityDate" style="padding:0.5rem; border:1px solid #cbd5e1; border-radius:6px;"><input type="time" id="doctorAvailabilityTime" style="padding:0.5rem; border:1px solid #cbd5e1; border-radius:6px;"><button type="button" id="doctorAvailabilitySubmit" class="attach-btn">Publish Slot</button></div></div>` : `<div style="display:flex; flex-direction:column; gap:0.4rem;"><label style="font-weight:600;">Select a date</label><div class="appointment-calendar">${upcomingDays}</div></div>`}
                    ${isDoctorRole ? '' : `<div style="display:flex; flex-direction:column; gap:0.4rem;"><label style="font-weight:600;">Available times</label><div style="display:flex; flex-wrap:wrap; gap:0.4rem;">${slotButtons}</div></div>`}
                    ${isDoctorRole ? '' : `<div style="display:flex; flex-direction:column; gap:0.4rem;"><label style="font-weight:600;">Consultation mode</label><select id="appointmentModeSelect" style="padding:0.5rem; border:1px solid #cbd5e1; border-radius:6px;"><option value="async"${appointmentState.mode === 'async' ? ' selected' : ''}>Asynchronous check-up</option><option value="sync"${appointmentState.mode === 'sync' ? ' selected' : ''}>Synchronous chat</option></select></div>`}
                    ${isDoctorRole ? '' : `<button type="button" id="appointmentBookBtn" class="attach-btn">Book Appointment</button>`}
                </div>
                <div class="appointment-card">
                    <h4 style="margin:0;">${isDoctorRole ? 'Appointment requests' : 'Your appointments'}</h4>
                    ${isDoctorRole ? doctorAvailabilityMarkup ? `<div style="display:flex; flex-direction:column; gap:0.5rem;"><div style="font-size:0.82rem; color:#6b7280;">Published availability</div>${doctorAvailabilityMarkup}</div>` : '<p style="margin:0; color:#6b7280;">No availability published yet.</p>' : ''}
                    ${appointmentsMarkup}
                </div>
            </div>
        `;
        if (!isDoctorRole) {
            const doctorSelect = document.getElementById('appointmentDoctorSelect');
            if (doctorSelect) {
                doctorSelect.value = appointmentState.doctorEmail || profile.preferredDoctorEmail || '';
                doctorSelect.addEventListener('change', function () {
                    appointmentState.doctorEmail = doctorSelect.value;
                    if (!appointmentState.date) {
                        const nextDate = new Date();
                        nextDate.setDate(nextDate.getDate() + 1);
                        appointmentState.date = nextDate.toISOString().split('T')[0];
                    }
                    renderAppointmentCenter();
                });
            }
            document.querySelectorAll('.day-pill[data-date]').forEach(function (button) {
                button.addEventListener('click', function () {
                    appointmentState.date = button.getAttribute('data-date');
                    renderAppointmentCenter();
                });
            });
            document.querySelectorAll('.slot-chip[data-time]').forEach(function (button) {
                button.addEventListener('click', function () {
                    appointmentState.time = button.getAttribute('data-time');
                    renderAppointmentCenter();
                });
            });
            const appointmentModeSelect = document.getElementById('appointmentModeSelect');
            if (appointmentModeSelect) {
                appointmentModeSelect.addEventListener('change', function () {
                    appointmentState.mode = appointmentModeSelect.value;
                });
            }
            const appointmentBookBtn = document.getElementById('appointmentBookBtn');
            if (appointmentBookBtn) {
                appointmentBookBtn.addEventListener('click', function () {
                    const selectedDoctor = doctors.find(function (doctor) {
                        return (doctor.email || '').toLowerCase() === (appointmentState.doctorEmail || profile.preferredDoctorEmail || '').toLowerCase();
                    });
                    if (!selectedDoctor || !appointmentState.date || !appointmentState.time) {
                        alert('Choose a doctor, date, and time first.');
                        return;
                    }
                    const store = getAppointmentStore();
                    store.push({
                        id: 'appt-' + Date.now(),
                        patientName: profile.name || 'Patient',
                        patientEmail: getCurrentUserEmail(),
                        doctorName: selectedDoctor.name || 'Doctor',
                        doctorEmail: selectedDoctor.email || '',
                        date: appointmentState.date,
                        time: appointmentState.time,
                        mode: appointmentState.mode || 'async',
                        status: 'pending',
                        createdAt: Date.now()
                    });
                    saveAppointmentStore(store);
                    appointmentState.time = '';
                    renderAppointmentCenter();
                    alert('Appointment request sent. Your doctor can accept it from the patient dashboard.');
                });
            }
        } else {
            const availabilitySubmit = document.getElementById('doctorAvailabilitySubmit');
            if (availabilitySubmit) {
                availabilitySubmit.addEventListener('click', function () {
                    const dateInput = document.getElementById('doctorAvailabilityDate');
                    const timeInput = document.getElementById('doctorAvailabilityTime');
                    if (!dateInput || !timeInput || !dateInput.value || !timeInput.value) {
                        alert('Select both a date and time.');
                        return;
                    }
                    const store = getAvailabilityStore();
                    const doctorEmail = getCurrentUserEmail();
                    const doctorName = profile.name || (storedUser && storedUser.name) || 'Doctor';
                    let entry = store.find(function (item) { return item.doctorEmail === doctorEmail && item.date === dateInput.value; });
                    if (!entry) {
                        entry = { doctorEmail, doctorName, date: dateInput.value, times: [] };
                        store.push(entry);
                    }
                    if (!entry.times.includes(timeInput.value)) entry.times.push(timeInput.value);
                    saveAvailabilityStore(store);
                    dateInput.value = '';
                    timeInput.value = '';
                    renderAppointmentCenter();
                });
            }
            document.querySelectorAll('.accept-appointment-btn').forEach(function (button) {
                button.addEventListener('click', function () {
                    const appointmentId = button.getAttribute('data-appointment-id');
                    const store = getAppointmentStore();
                    const target = store.find(function (entry) { return entry.id === appointmentId; });
                    if (!target) return;
                    target.status = 'accepted';
                    saveAppointmentStore(store);
                    renderAppointmentCenter();
                });
            });
        }
    }

    function loadMasterChatDb() { return JSON.parse(localStorage.getItem('optiScanMasterChats') || '[]'); }
    function saveMasterChatDb(db) { localStorage.setItem('optiScanMasterChats', JSON.stringify(db)); }

    function cleanupSamplePatientData() {
        try {
            const registry = getPatientRegistry();
            const filteredRegistry = registry.filter(function (entry) {
                return !((entry.name || '').trim().toLowerCase() === 'sample patient');
            });
            if (filteredRegistry.length !== registry.length) {
                savePatientRegistry(filteredRegistry);
            }

            const chatDb = loadMasterChatDb();
            const filteredChatDb = chatDb.filter(function (entry) {
                const patientName = (entry.patientName || '').trim().toLowerCase();
                const receiverId = (entry.receiverId || '').trim().toLowerCase();
                return patientName !== 'sample patient' && receiverId !== 'sample patient';
            });
            if (filteredChatDb.length !== chatDb.length) {
                saveMasterChatDb(filteredChatDb);
            }
        } catch (error) {
            // Ignore cleanup failures and continue.
        }
    }

    function closeAllDropdowns() { document.querySelectorAll('.msg-dropdown-menu').forEach(menu => menu.classList.remove('show')); }

    function getDefaultRegisteredUsers() {
        return [];
    }

    function getRegisteredUsers() {
        try {
            const savedUsers = JSON.parse(localStorage.getItem('optiScanUsers') || '[]');
            const users = Array.isArray(savedUsers) ? savedUsers : [];
            if (!users.length) {
                localStorage.setItem('optiScanUsers', JSON.stringify(getDefaultRegisteredUsers()));
                return getDefaultRegisteredUsers();
            }
            return users;
        } catch (error) {
            localStorage.setItem('optiScanUsers', JSON.stringify(getDefaultRegisteredUsers()));
            return getDefaultRegisteredUsers();
        }
    }

    async function syncRegisteredAccountsFromServer() {
        try {
            const response = await fetch('/api/accounts', { credentials: 'include' });
            if (!response.ok) return;
            const data = await response.json();
            const users = Array.isArray(data.users) ? data.users : [];
            const pending = Array.isArray(data.pending) ? data.pending : [];
            localStorage.setItem('optiScanUsers', JSON.stringify(users));
            localStorage.setItem('optiScanPendingRegistrations', JSON.stringify(pending));
        } catch (error) {
            const fallbackUsers = JSON.parse(localStorage.getItem('optiScanUsers') || '[]');
            if (!Array.isArray(fallbackUsers) || fallbackUsers.length === 0) {
                localStorage.setItem('optiScanUsers', JSON.stringify([]));
            }
        }
    }

    function getPatientRegistry() {
        try {
            const savedRegistry = JSON.parse(localStorage.getItem('optiScanPatientRegistry') || '[]');
            const registeredUsers = getRegisteredUsers();
            const normalizedRegistry = Array.isArray(savedRegistry) ? savedRegistry : [];
            return normalizedRegistry.filter(function (entry) {
                const patientName = (entry.name || '').trim().toLowerCase();
                if (!patientName) return false;
                const isMedicalProfessionalRecord = registeredUsers.some(function (user) {
                    return ((user.name || '').trim().toLowerCase() === patientName) && String(user.role || '').toLowerCase() === 'medical-professional';
                });
                return !isMedicalProfessionalRecord;
            });
        } catch (error) {
            return [];
        }
    }

    function savePatientRegistry(registry) {
        localStorage.setItem('optiScanPatientRegistry', JSON.stringify(registry));
    }

    function ensurePatientRecord(name) {
        const normalizedName = (name || '').trim();
        if (!normalizedName) return null;
        const registry = getPatientRegistry();
        let record = registry.find(entry => (entry.name || '').trim().toLowerCase() === normalizedName.toLowerCase());
        if (!record) {
            record = {
                name: normalizedName,
                diagnosis: 'Awaiting diagnosis update.',
                status: 'pending',
                profile: {
                    birthdate: '',
                    age: '',
                    medicalHistory: 'No major complications reported.'
                }
            };
            registry.push(record);
        }

        const currentProfileName = (profile.name || '').trim().toLowerCase();
        const normalizedRecordName = (record.name || '').trim().toLowerCase();
        if (currentProfileName && normalizedRecordName === currentProfileName) {
            record.profile = Object.assign({}, record.profile || {}, {
                birthdate: profile.birthdate || record.profile?.birthdate || '',
                age: profile.age || record.profile?.age || '',
                medicalHistory: profile.medicalHistory || record.profile?.medicalHistory || 'No major complications reported.'
            });
            if (!record.diagnosis) record.diagnosis = 'Awaiting diagnosis update.';
        }
        savePatientRegistry(registry);
        return record;
    }

    function formatTimestamp(timestamp) {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleString([], {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[char]));
    }

    function getQualifiedDoctors() {
        try {
            const allUsers = JSON.parse(localStorage.getItem('optiScanUsers') || '[]');
            const doctors = (Array.isArray(allUsers) ? allUsers : []).filter(function (user) {
                const role = String(user.role || '').toLowerCase();
                return role === 'medical-professional' && (user.isQualified || (user.qualifications || '').trim());
            });
            return doctors.map(function (doctor) {
                return {
                    email: doctor.email || '',
                    name: doctor.name || 'Dr. Unknown',
                    qualifications: doctor.qualifications || '',
                    role: doctor.role || 'medical-professional'
                };
            });
        } catch (error) {
            return [];
        }
    }

    function getCurrentUserEmail() {
        return (storedUser && (storedUser.email || '')) || (profile && profile.doctorEmail) || '';
    }

    function makeChatThreadId(patientName) {
        const normalized = (patientName || '').trim().toLowerCase();
        return normalized ? `patient:${normalized}` : 'patient:guest';
    }

    function getSelectedChatThreadId() {
        return selectedChatId || makeChatThreadId(profile.name || 'Guest');
    }

    function canAccessPatient(patient) {
        if (!patient) return false;
        if (isAdminMode) return true;
        const patientName = (patient.name || '').trim().toLowerCase();
        const currentProfileName = (profile.name || '').trim().toLowerCase();
        const currentEmail = (getCurrentUserEmail() || '').trim().toLowerCase();
        const assignedEmail = (patient.assignedDoctorEmail || '').trim().toLowerCase();
        const assignedName = (patient.assignedDoctorName || '').trim().toLowerCase();
        if (currentRole === 'patient') {
            return patientName === currentProfileName;
        }
        if (currentRole === 'medical-professional' && isQualifiedProfessional) {
            if (!assignedEmail && !assignedName) return false;
            return (assignedEmail && assignedEmail === currentEmail) || (assignedName && assignedName === currentProfileName);
        }
        return false;
    }

    function acceptPatient(patientName) {
        const registry = getPatientRegistry();
        const target = registry.find(entry => entry.name.toLowerCase() === (patientName || '').toLowerCase());
        if (!target) return;
        const doctorEmail = (profile && profile.doctorEmail) || (storedUser && storedUser.email ? storedUser.email : '');
        const doctorPhone = (profile && profile.doctorPhone) || '';
        target.status = 'accepted';
        target.acceptedAt = Date.now();
        target.assignedDoctorName = profile.name || (storedUser && storedUser.name) || 'Dr. Unknown';
        target.assignedDoctorEmail = doctorEmail;
        target.assignedDoctorPhone = doctorPhone;
        target.assignedBy = 'doctor';
        savePatientRegistry(registry);
        selectedCarePatient = target.name;
        selectedChatId = makeChatThreadId(target.name);
        if (chatContactName) chatContactName.textContent = target.name;
        renderCareDashboard();
        const chatsButton = document.querySelector('.tab-btn[data-target="chats"]');
        if (chatsButton) chatsButton.click();
    }

    function transferPatient(patientName, doctorEmail, doctorName) {
        const registry = getPatientRegistry();
        const target = registry.find(entry => entry.name.toLowerCase() === (patientName || '').toLowerCase());
        if (!target) return;
        target.status = 'transferred';
        target.assignedDoctorName = doctorName || 'Transferred doctor';
        target.assignedDoctorEmail = doctorEmail || '';
        target.assignedBy = 'transfer';
        savePatientRegistry(registry);
        selectedCarePatient = target.name;
        renderCareDashboard();
    }

    function renderCareDashboard() {
        if (!carePatientList || !carePatientName || !carePatientProfile || !careChatWindow || !careChatForm || !careChatInput) return;
        const careThreadBlock = document.querySelector('#care .care-chat-block');
        if (careThreadBlock) {
            careThreadBlock.style.display = isAdminMode ? 'none' : 'flex';
        }
        let registry = getPatientRegistry();
        const visibleRegistry = registry.filter(function (entry) {
            return isAdminMode || canAccessPatient(entry);
        });

        if (!visibleRegistry.length) {
            carePatientList.innerHTML = '<p class="care-empty-state">No assigned patients are available yet.</p>';
            carePatientName.textContent = 'Select a patient';
            carePatientProfile.innerHTML = '<p class="care-empty-state">Patient details will appear here.</p>';
            careChatWindow.innerHTML = '<p class="care-empty-state">No patient thread selected.</p>';
            return;
        }

        if (!selectedCarePatient || !visibleRegistry.some(entry => entry.name === selectedCarePatient)) {
            selectedCarePatient = visibleRegistry[0].name;
        }
        carePatientList.innerHTML = '';
        visibleRegistry.forEach(function (entry) {
            const row = document.createElement('div');
            row.className = 'care-patient-row';

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'care-patient-btn' + (selectedCarePatient === entry.name ? ' active' : '');
            button.textContent = entry.name;
            button.addEventListener('click', function () {
                selectedCarePatient = entry.name;
                selectedChatId = makeChatThreadId(entry.name);
                if (chatContactName) chatContactName.textContent = entry.name;
                renderCareDashboard();
                renderChatThreadLogs();
            });

            const statusBadge = document.createElement('span');
            const statusKey = entry.status === 'accepted' ? 'accepted' : entry.status === 'transferred' ? 'transferred' : 'pending';
            statusBadge.className = 'care-patient-status ' + statusKey;
            statusBadge.textContent = entry.status === 'accepted' ? 'Accepted' : entry.status === 'transferred' ? 'Transferred' : 'Pending';

            row.appendChild(button);
            row.appendChild(statusBadge);
            if (entry.status === 'pending' && (isAdminMode || (currentRole === 'medical-professional' && isQualifiedProfessional))) {
                const acceptBtn = document.createElement('button');
                acceptBtn.type = 'button';
                acceptBtn.className = 'care-patient-accept';
                acceptBtn.textContent = 'Accept';
                acceptBtn.addEventListener('click', function (event) {
                    event.stopPropagation();
                    acceptPatient(entry.name);
                });
                row.appendChild(acceptBtn);
            }
            carePatientList.appendChild(row);
        });

        const activePatient = visibleRegistry.find(entry => entry.name === selectedCarePatient);
        if (!activePatient) {
            carePatientName.textContent = 'Select a patient';
            carePatientProfile.innerHTML = '<p class="care-empty-state">Patient details will appear here.</p>';
            careChatWindow.innerHTML = '<p class="care-empty-state">Select a patient to begin.</p>';
            return;
        }

        carePatientName.textContent = activePatient.name;
        const activePatientName = (activePatient.name || '').trim().toLowerCase();
        const currentProfileName = (profile.name || '').trim().toLowerCase();
        const patientProfile = activePatientName && currentProfileName && activePatientName === currentProfileName
            ? {
                birthdate: profile.birthdate || activePatient.profile?.birthdate || '',
                age: profile.age || activePatient.profile?.age || '',
                medicalHistory: profile.medicalHistory || activePatient.profile?.medicalHistory || 'No major complications reported.'
            }
            : (activePatient.profile || {});

        carePatientProfile.innerHTML = `
            <div class="care-profile-block">
                <div class="care-info-row">
                    <div><strong>Patient</strong><p>${escapeHtml(activePatient.name)}</p></div>
                    <div><strong>Status</strong><p>${escapeHtml(activePatient.status || 'pending')}</p></div>
                </div>
                <div class="care-info-row">
                    <div><strong>Birthdate</strong><p>${escapeHtml(patientProfile.birthdate || 'Not provided')}</p></div>
                    <div><strong>Age</strong><p>${escapeHtml(patientProfile.age || 'N/A')}</p></div>
                </div>
                <div class="care-info-row">
                    <div style="flex:1"><strong>Medical history</strong><p>${escapeHtml(patientProfile.medicalHistory || 'No history available.')}</p></div>
                </div>
                <div class="care-info-row">
                    <div style="flex:1"><strong>Diagnosis</strong><p>${escapeHtml(activePatient.diagnosis || 'Awaiting diagnosis update.')}</p></div>
                </div>
            </div>
        `;

        if (chatContactName) {
            chatContactName.textContent = activePatient.name;
        }
        if (!selectedChatId) {
            selectedChatId = makeChatThreadId(activePatient.name);
        }
        renderChatThreadLogs();
    }

    function getStoredChatThreads() {
        try {
            const stored = JSON.parse(localStorage.getItem('optiScanMasterChats') || '[]');
            return Array.isArray(stored) ? stored : [];
        } catch (error) {
            return [];
        }
    }

    function saveStoredChatThreads(threads) {
        localStorage.setItem('optiScanMasterChats', JSON.stringify(threads));
    }

    function getChatThread(threadId) {
        const threads = getStoredChatThreads();
        let thread = threads.find(function (entry) { return entry.id === threadId; });
        if (!thread) {
            thread = { id: threadId, patientName: selectedCarePatient || profile.name || 'Guest', messages: [] };
            threads.push(thread);
            saveStoredChatThreads(threads);
        }
        return thread;
    }

    function setCurrentChatThread(threadId) {
        selectedChatId = threadId;
        renderChatSidebar();
        renderChatThreadLogs();
    }

    function getChatThreads() {
        const registry = getPatientRegistry();
        const threads = [];
        if (currentRole === 'patient' || currentRole === 'admin') {
            const patientName = (profile.name || 'Guest').trim() || 'Guest';
            threads.push({ id: makeChatThreadId(patientName), title: 'My consultation', patientName });
        }
        if (currentRole === 'medical-professional' || isAdminMode) {
            registry.filter(function (entry) { return canAccessPatient(entry); }).forEach(function (entry) {
                threads.push({ id: makeChatThreadId(entry.name), title: entry.name, patientName: entry.name });
            });
        }
        if (!threads.length && currentRole === 'patient') {
            const patientName = (profile.name || 'Guest').trim() || 'Guest';
            threads.push({ id: makeChatThreadId(patientName), title: 'My consultation', patientName });
        }
        if (!selectedChatId && threads.length) {
            selectedChatId = threads[0].id;
        }
        return threads;
    }

    function renderChatSidebar() {
        if (!chatSidebar) return;
        const threads = getChatThreads();
        chatSidebar.innerHTML = '';
        if (!threads.length) {
            chatSidebar.innerHTML = '<p style="color:#6b7280; margin:0;">No conversation threads are available.</p>';
            return;
        }
        threads.forEach(function (thread) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'tab-btn';
            if (thread.id === selectedChatId) button.classList.add('active');
            button.textContent = thread.title || thread.patientName || 'Conversation';
            button.addEventListener('click', function () {
                setCurrentChatThread(thread.id);
            });
            chatSidebar.appendChild(button);
        });
    }

    function createChatMessageElement(message) {
        const wrapper = document.createElement('div');
        const isOwnMessage = message.sender === (currentRole === 'medical-professional' ? 'doctor' : 'patient');
        wrapper.className = 'chat-message-wrapper ' + (isOwnMessage ? 'sender-me' : 'sender-them');

        const bubble = document.createElement('div');
        bubble.className = 'chat-message ' + (isOwnMessage ? 'sender-me' : 'sender-them');

        if (message.text) {
            const textNode = document.createElement('div');
            textNode.textContent = message.text;
            bubble.appendChild(textNode);
        }
        if (message.attachment) {
            bubble.appendChild(buildMessageBody({ attachment: message.attachment }));
        }
        const meta = document.createElement('div');
        meta.className = 'chat-time';
        meta.textContent = `${message.sender === 'doctor' ? 'Doctor' : 'Patient'} · ${formatTimestamp(message.createdAt)}`;
        bubble.appendChild(meta);
        wrapper.appendChild(bubble);
        return wrapper;
    }

    function renderChatThreadLogs() {
        if (!chatWindow) return;
        const threadId = getSelectedChatThreadId();
        const thread = getChatThread(threadId);
        const messages = Array.isArray(thread.messages) ? thread.messages : [];
        chatWindow.innerHTML = '';
        if (chatContactName) {
            chatContactName.textContent = thread.patientName || 'Consultation';
        }
        if (!messages.length) {
            chatWindow.innerHTML = '<p style="color:#6b7280; margin:0;">No messages yet. Start the conversation below.</p>';
            return;
        }
        messages.forEach(function (message) {
            chatWindow.appendChild(createChatMessageElement(message));
        });
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }

    function renderCareChatThreadLogs() {
        if (!careChatWindow) return;
        const threadId = getSelectedChatThreadId();
        const thread = getChatThread(threadId);
        const messages = Array.isArray(thread.messages) ? thread.messages : [];
        careChatWindow.innerHTML = '';
        if (!messages.length) {
            careChatWindow.innerHTML = '<p class="care-empty-state">No notes yet. Send a follow-up message below.</p>';
            return;
        }
        messages.forEach(function (message) {
            const entry = document.createElement('div');
            entry.className = 'care-chat-entry';
            const senderName = document.createElement('div');
            senderName.className = 'chat-sender-name';
            senderName.textContent = message.sender === 'doctor' ? 'Doctor' : 'Patient';
            const messageText = document.createElement('div');
            messageText.textContent = message.text || '';
            const messageTime = document.createElement('div');
            messageTime.className = 'care-chat-time';
            messageTime.textContent = formatTimestamp(message.createdAt);
            entry.appendChild(senderName);
            entry.appendChild(messageText);
            entry.appendChild(messageTime);
            if (message.attachment) {
                const attachmentBody = buildMessageBody({ attachment: message.attachment });
                entry.appendChild(attachmentBody);
            }
            careChatWindow.appendChild(entry);
        });
        careChatWindow.scrollTop = careChatWindow.scrollHeight;
    }

    function sendChatMessage(text, messageSender) {
        const trimmedText = String(text || '').trim();
        const threadId = getSelectedChatThreadId();
        const chatDb = getStoredChatThreads();
        if (!trimmedText && !pendingChatAttachment) {
            return;
        }
        let threadIndex = chatDb.findIndex(function (item) { return item.id === threadId; });
        let thread = threadIndex === -1 ? null : chatDb[threadIndex];
        if (!thread) {
            thread = { id: threadId, patientName: selectedCarePatient || profile.name || 'Guest', messages: [] };
            chatDb.push(thread);
            threadIndex = chatDb.length - 1;
        }
        const message = {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            sender: messageSender,
            text: trimmedText,
            attachment: pendingChatAttachment,
            createdAt: Date.now()
        };
        thread.messages = Array.isArray(thread.messages) ? thread.messages : [];
        thread.messages.push(message);
        saveStoredChatThreads(chatDb);
        pendingChatAttachment = null;
        if (chatAttachmentLabel) chatAttachmentLabel.textContent = 'No attachment';
        if (chatInput) chatInput.value = '';
        if (careChatInput) careChatInput.value = '';
        renderChatThreadLogs();
        renderCareChatThreadLogs();
    }

    function handleChatFormSubmit(event) {
        if (event && event.preventDefault) event.preventDefault();
        const sender = currentRole === 'medical-professional' ? 'doctor' : 'patient';
        sendChatMessage(chatInput ? chatInput.value : '', sender);
    }

    function handleCareChatFormSubmit(event) {
        if (event && event.preventDefault) event.preventDefault();
        const sender = currentRole === 'medical-professional' ? 'doctor' : 'patient';
        sendChatMessage(careChatInput ? careChatInput.value : '', sender);
    }

    if (chatAttachmentBtn && chatAttachmentFile && chatAttachmentLabel) {
        chatAttachmentBtn.addEventListener('click', function () {
            chatAttachmentFile.click();
        });
        chatAttachmentFile.addEventListener('change', async function (event) {
            const file = event.target.files && event.target.files[0];
            if (!file) return;
            const dataUrl = await readFileAsDataUrl(file);
            pendingChatAttachment = {
                name: file.name,
                type: file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'file',
                dataUrl
            };
            chatAttachmentLabel.textContent = file.name;
        });
    }

    if (chatForm) {
        chatForm.addEventListener('submit', handleChatFormSubmit);
    }
    if (careChatForm) {
        careChatForm.addEventListener('submit', handleCareChatFormSubmit);
    }
    if (logoutLink) {
        logoutLink.addEventListener('click', logoutFromDashboard);
    }

    function showTab(targetId) {
        document.querySelectorAll('.tab-btn').forEach(function (button) {
            const active = button.dataset.target === targetId;
            button.classList.toggle('active', active);
        });
        document.querySelectorAll('.tab-panel').forEach(function (panel) {
            panel.classList.toggle('active', panel.id === targetId);
        });
        if (targetId === 'chats') {
            renderChatSidebar();
            renderChatThreadLogs();
        }
        if (targetId === 'care') {
            renderCareDashboard();
        }
    }

    document.querySelectorAll('aside.sidebar .tab-nav .tab-btn').forEach(function (button) {
        button.addEventListener('click', function () {
            const target = button.dataset.target;
            if (target) {
                showTab(target);
            }
        });
    });

    if (adminTabBtn) {
        adminTabBtn.hidden = !isAdminMode;
    }

    updateRoleUI();
    renderDoctorDirectory();
    renderPreferredDoctorOptions();
    renderAppointmentCenter();
    renderChatSidebar();
    renderChatThreadLogs();
    renderCareDashboard();
});
