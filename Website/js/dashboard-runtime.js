
        let currentRole = 'patient';
        let isAdminMode = false;
        let isQualifiedProfessional = false;

        function logoutFromDashboard(event) {
            if (event && event.preventDefault) event.preventDefault();
            localStorage.removeItem('optiScanCurrentUser');
            window.location.href = 'OptiScan.html';
            return false;
        }

        document.addEventListener('DOMContentLoaded', async function () {
            const body = document.body;
            const settingsThemeSelect = document.getElementById('settingsThemeSelect');
            const settingsFontSelect = document.getElementById('settingsFontSelect');
            const themeToggleBtn = document.getElementById('themeToggleBtn');

            let currentTheme = localStorage.getItem('optiScanTheme') || 'light';
            function applyDashboardTheme(theme) {
                currentTheme = theme;
                body.setAttribute('data-theme', theme);
                body.classList.toggle('dark-mode', theme === 'dark');
                if (settingsThemeSelect) settingsThemeSelect.value = theme;
                if (themeToggleBtn) themeToggleBtn.textContent = theme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode';
                localStorage.setItem('optiScanTheme', theme);
            }
            applyDashboardTheme(currentTheme);
            if (settingsThemeSelect) {
                settingsThemeSelect.addEventListener('change', (e) => applyDashboardTheme(e.target.value));
            }
            if (themeToggleBtn) {
                themeToggleBtn.addEventListener('click', () => applyDashboardTheme(currentTheme === 'dark' ? 'light' : 'dark'));
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
            function getStoredUser() {
                try {
                    return JSON.parse(localStorage.getItem('optiScanCurrentUser') || 'null');
                } catch (error) {
                    return null;
                }
            }
            const storedUser = getStoredUser();
            currentRole = params.get('role') || (storedUser && storedUser.role) || 'patient';
            isAdminMode = (currentRole === 'admin');
            isQualifiedProfessional = Boolean(storedUser && storedUser.role === 'medical-professional' && (storedUser.isQualified || storedUser.qualifications));

            const heading = document.getElementById('welcome-heading');
            const logoutLink = document.getElementById('logoutLink');
            const profileNameInput = document.getElementById('profile-name-input');
            const profileRoleBadge = document.getElementById('profile-role');
            const profileBirthdateInput = document.getElementById('profile-birthdate');
            const profileAgeInput = document.getElementById('profile-age');
            const profileHistoryInput = document.getElementById('profile-history');
            const profileQualificationsInput = document.getElementById('profile-qualifications-input');
            const profileHospitalInput = document.getElementById('profile-hospital-input');
            const profileLocationInput = document.getElementById('profile-location-input');
            const profileDoctorEmailInput = document.getElementById('profile-doctor-email-input');
            const profileDoctorPhoneInput = document.getElementById('profile-doctor-phone-input');
            const doctorProfileFields = document.getElementById('doctorProfileFields');
            const saveProfileButton = document.getElementById('saveProfileBtn');
            
            const chatForm = document.getElementById('chatForm');
            const chatInput = document.getElementById('chatInput');
            const chatWindow = document.getElementById('chatWindow');
            const chatSidebar = document.getElementById('chatSidebar');
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
                    container.innerHTML = '<p style="margin: 0; color: #6b7280;">No verified doctors available yet.</p>';
                    return;
                }
                doctors.forEach(function (doctor) {
                    const card = document.createElement('div');
                    card.style.cssText = 'padding: 0.8rem; border: 1px solid #e5e7eb; border-radius: 8px; background: #f9fafb;';

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

                    const phoneEl = document.createElement('div');
                    phoneEl.style.cssText = 'font-size:0.84rem; color:#6b7280;';
                    const phoneLabel = document.createElement('strong');
                    phoneLabel.textContent = 'Phone:';
                    phoneEl.appendChild(phoneLabel);
                    phoneEl.appendChild(document.createTextNode(' ' + (doctor.phone || 'Not provided')));
                    card.appendChild(phoneEl);

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
                doctorPhone: ''
            };

            function calculateAge(birthdate) {
                if (!birthdate) return '';
                const birth = new Date(birthdate);
                const today = new Date();
                let age = today.getFullYear() - birth.getFullYear();
                if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age--;
                return age;
            }

            let profile = Object.assign({}, defaultProfile, JSON.parse(localStorage.getItem(profileStorageKey) || '{}'));
            if (profile.birthdate && !profile.age) profile.age = calculateAge(profile.birthdate);

            const isDoctorProfile = currentRole === 'medical-professional' || (storedUser && storedUser.role === 'medical-professional');
            if (doctorProfileFields) {
                doctorProfileFields.style.display = isDoctorProfile ? 'flex' : 'none';
            }

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
            if (profileQualificationsInput) profileQualificationsInput.value = profile.qualifications || '';
            if (profileHospitalInput) profileHospitalInput.value = profile.hospital || '';
            if (profileLocationInput) profileLocationInput.value = profile.location || '';
            if (profileDoctorEmailInput) profileDoctorEmailInput.value = profile.doctorEmail || '';
            if (profileDoctorPhoneInput) profileDoctorPhoneInput.value = profile.doctorPhone || '';
            if (profileRoleBadge) {
                profileRoleBadge.textContent = currentRole === 'medical-professional'
                    ? (isQualifiedProfessional ? 'Medical Professional (Qualified)' : 'Medical Professional (Pending Qualification)')
                    : (currentRole === 'admin' ? 'Administrator' : 'Patient');
            }

            if (profileBirthdateInput) {
                profileBirthdateInput.addEventListener('change', () => {
                    profile.age = calculateAge(profileBirthdateInput.value);
                    if (profileAgeInput) profileAgeInput.value = profile.age;
                });
            }

            if (saveProfileButton) {
                saveProfileButton.addEventListener('click', () => {
                    profile.name = profileNameInput.value.trim();
                    profile.birthdate = profileBirthdateInput.value;
                    profile.age = profileAgeInput.value.trim();
                    profile.medicalHistory = profileHistoryInput.value;
                    profile.qualifications = profileQualificationsInput ? profileQualificationsInput.value.trim() : '';
                    profile.hospital = profileHospitalInput ? profileHospitalInput.value.trim() : '';
                    profile.location = profileLocationInput ? profileLocationInput.value.trim() : '';
                    profile.doctorEmail = profileDoctorEmailInput ? profileDoctorEmailInput.value.trim() : '';
                    profile.doctorPhone = profileDoctorPhoneInput ? profileDoctorPhoneInput.value.trim() : '';
                    localStorage.setItem(profileStorageKey, JSON.stringify(profile));
                    ensurePatientRecord(profile.name);
                    alert('Profile configuration updated successfully.');
                });
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
                    const response = await fetch('/api/accounts');
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
                selectedChatId = target.name;
                if (chatContactName) chatContactName.textContent = target.name;
                renderCareDashboard();
                const chatsButton = document.querySelector('.tab-btn[data-target="chats"]');
                if (chatsButton) chatsButton.click();
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
                        if (chatContactName) chatContactName.textContent = entry.name;
                        selectedChatId = entry.name;
                        renderCareDashboard();
                        renderChatThreadLogs();
                    });

                    const statusBadge = document.createElement('span');
                    statusBadge.className = 'care-patient-status ' + (entry.status === 'accepted' ? 'accepted' : 'pending');
                    statusBadge.textContent = entry.status === 'accepted' ? 'Accepted' : 'Pending';

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
                const doctorContact = activePatient.assignedDoctorEmail || activePatient.assignedDoctorPhone
                    ? `${activePatient.assignedDoctorEmail || 'No email shared'}${activePatient.assignedDoctorPhone ? ' • ' + activePatient.assignedDoctorPhone : ''}`
                    : 'No assigned doctor';
                const doctors = getQualifiedDoctors();
                const assignmentOptions = doctors.map(function (doctor) {
                    const selected = (activePatient.assignedDoctorEmail || '').toLowerCase() === (doctor.email || '').toLowerCase() ? ' selected' : '';
                    return `<option value="${escapeHtml(doctor.email || '')}"${selected}>${escapeHtml(doctor.name || 'Doctor')}</option>`;
                }).join('');
                const assignmentControl = (isAdminMode || (currentRole === 'medical-professional' && isQualifiedProfessional))
                    ? `<div class="care-assignment-row" style="margin-top:0.75rem;">
                        <label style="display:block; margin-bottom:0.35rem; font-weight:600;">Assign a doctor</label>
                        <select id="doctorAssignmentSelect" style="width:100%; padding:0.5rem; border:1px solid #cbd5e1; border-radius:6px;">
                            <option value="">No assigned doctor</option>
                            ${assignmentOptions}
                        </select>
                    </div>`
                    : '';
                carePatientProfile.innerHTML = `
                    <div class="care-info-row"><span>Birthdate</span><strong>${escapeHtml(patientProfile.birthdate || 'Not provided')}</strong></div>
                    <div class="care-info-row"><span>Age</span><strong>${escapeHtml(patientProfile.age || 'Not provided')}</strong></div>
                    <div class="care-info-row"><span>Medical History</span><strong>${escapeHtml(patientProfile.medicalHistory || 'No major complications reported.')}</strong></div>
                    <div class="care-info-row"><span>Diagnosis</span><strong>${escapeHtml(activePatient.diagnosis || 'Awaiting diagnosis update.')}</strong></div>
                    <div class="care-info-row"><span>Assigned Doctor</span><strong>${escapeHtml(activePatient.assignedDoctorName || 'Pending assignment')}</strong></div>
                    <div class="care-info-row"><span>Doctor Contact</span><strong>${escapeHtml(doctorContact)}</strong></div>
                    ${assignmentControl}
                `;

                const assignmentSelect = document.getElementById('doctorAssignmentSelect');
                if (assignmentSelect) {
                    assignmentSelect.addEventListener('change', function () {
                        const registryData = getPatientRegistry();
                        const targetPatient = registryData.find(entry => entry.name === activePatient.name);
                        if (!targetPatient) return;
                        const selectedDoctor = doctors.find(function (doctor) {
                            return (doctor.email || '').toLowerCase() === (assignmentSelect.value || '').toLowerCase();
                        });
                        targetPatient.assignedDoctorEmail = assignmentSelect.value || '';
                        targetPatient.assignedDoctorName = selectedDoctor ? (selectedDoctor.name || 'Dr. Unknown') : '';
                        targetPatient.status = assignmentSelect.value ? 'accepted' : 'pending';
                        savePatientRegistry(registryData);
                        renderCareDashboard();
                    });
                }

                const db = loadMasterChatDb();
                const visibleLogs = db.filter(function (message) {
                    return message.patientName === activePatient.name || message.receiverId === activePatient.name;
                }).slice(-10);

                careChatWindow.innerHTML = '';
                if (!visibleLogs.length) {
                    careChatWindow.innerHTML = '<p class="care-empty-state">No recent messages for this patient.</p>';
                } else {
                    visibleLogs.forEach(function (message) {
                        const entry = document.createElement('div');
                        entry.className = 'care-chat-entry';
                        const senderLabel = message.direction === 'responder-to-patient' ? 'You' : activePatient.name;
                        const text = document.createElement('div');
                        text.textContent = message.text || '';
                        const timestamp = document.createElement('div');
                        timestamp.className = 'care-chat-time';
                        timestamp.textContent = formatTimestamp(message.createdAt || message.timestamp);
                        entry.appendChild(document.createElement('strong')).appendChild(document.createTextNode(senderLabel));
                        entry.appendChild(text);
                        entry.appendChild(timestamp);
                        careChatWindow.appendChild(entry);
                    });
                }
            }

            const isMedicalResponder = isAdminMode || (currentRole === 'medical-professional' && isQualifiedProfessional);
            const isMedicalProfessionalView = isAdminMode || (currentRole === 'medical-professional' && isQualifiedProfessional);
            if (careTabButton) careTabButton.hidden = !isMedicalProfessionalView;

            if (isMedicalResponder) {
                if (chatTerminalTitle) chatTerminalTitle.textContent = "Responder Desk Terminal";
                if (chatTerminalSubtitle) chatTerminalSubtitle.textContent = "Review active incoming diagnostic threads and support claims.";
                if (sidebarPanelHeader) sidebarPanelHeader.textContent = "Patient Records Queue";
            } else {
                if (chatTerminalTitle) chatTerminalTitle.textContent = "Clinical Consultation Terminal";
                if (sidebarPanelHeader) sidebarPanelHeader.textContent = "Specialist Directory";
            }

            function rebuildSidebarChannels() {
                if (!chatSidebar) return;
                chatSidebar.innerHTML = '';
                const db = loadMasterChatDb();
                const helpDeskChannel = { id: 'Help Desk', name: 'Help Desk', role: 'Admin-managed site concerns' };
                const registry = getPatientRegistry();

                if (isAdminMode) {
                    const channels = [helpDeskChannel];
                    channels.forEach(function (channel) {
                        const btn = document.createElement('button');
                        btn.style.cssText = 'display:block; width:100%; text-align:left; padding:0.75rem 1rem; margin-bottom:0.25rem; border:none; background:transparent; color:#111827; cursor:pointer; border-radius:6px;';
                        btn.innerHTML = `<strong style="color:#111827;">${escapeHtml(channel.name)}</strong><br><small style="color:#6b7280;">${escapeHtml(channel.role)}</small>`;
                        btn.onclick = function () {
                            selectedChatId = channel.id;
                            if (chatContactName) chatContactName.textContent = channel.name;
                            renderChatThreadLogs();
                        };
                        chatSidebar.appendChild(btn);
                    });
                    if (!selectedChatId) {
                        selectedChatId = helpDeskChannel.id;
                        if (chatContactName) chatContactName.textContent = helpDeskChannel.name;
                    }
                    renderChatThreadLogs();
                    return;
                }

                if (isMedicalResponder) {
                    const patientNamesFromDb = db.map(message => message.patientName).filter(Boolean);
                    const assignedPatients = registry.filter(function (entry) {
                        return canAccessPatient(entry);
                    }).map(function (entry) {
                        return entry.name;
                    });
                    const uniquePatients = [...new Set([...patientNamesFromDb, ...assignedPatients])].filter(Boolean);
                    const channels = [helpDeskChannel].concat(uniquePatients.map(patient => ({ id: patient, name: patient, role: 'Assigned patient' })));
                    if (channels.length === 0) {
                        chatSidebar.innerHTML = '<p style="color:#9ca3af; padding:1rem; text-align:center;">No conversations available yet.</p>';
                        return;
                    }
                    channels.forEach(function (channel) {
                        const btn = document.createElement('button');
                        btn.style.cssText = 'display:block; width:100%; text-align:left; padding:0.75rem 1rem; margin-bottom:0.25rem; border:none; background:transparent; color:#111827; cursor:pointer; border-radius:6px;';
                        btn.innerHTML = `<strong style="color:#111827;">${escapeHtml(channel.name)}</strong><br><small style="color:${channel.id === 'Help Desk' ? '#6b7280' : '#dc2626'};">${escapeHtml(channel.role)}</small>`;
                        btn.onclick = function () {
                            selectedChatId = channel.id;
                            if (chatContactName) chatContactName.textContent = channel.name;
                            if (channel.id !== 'Help Desk') {
                                selectedCarePatient = channel.id;
                            }
                            renderCareDashboard();
                            renderChatThreadLogs();
                        };
                        chatSidebar.appendChild(btn);
                    });
                    if (!selectedChatId && channels.length > 0) {
                        selectedChatId = channels[0].id;
                        if (channels[0].id !== 'Help Desk') {
                            selectedCarePatient = channels[0].id;
                        }
                        if (chatContactName) chatContactName.textContent = channels[0].name;
                    }
                } else {
                    const currentPatientRecord = registry.find(entry => (entry.name || '').trim().toLowerCase() === (profile.name || '').trim().toLowerCase());
                    const staticChannels = [];
                    if (currentPatientRecord && currentPatientRecord.assignedDoctorName) {
                        staticChannels.push({ id: currentPatientRecord.assignedDoctorName, name: currentPatientRecord.assignedDoctorName || 'Doctor', role: 'Assigned doctor' });
                    }
                    staticChannels.push(helpDeskChannel);
                    staticChannels.forEach(function (channel) {
                        const btn = document.createElement('button');
                        btn.style.cssText = 'display:block; width:100%; text-align:left; padding:0.75rem 1rem; margin-bottom:0.25rem; border:none; background:transparent; color:#111827; cursor:pointer; border-radius:6px;';
                        btn.innerHTML = `<strong style="color:#111827;">${escapeHtml(channel.name)}</strong><br><small style="color:#6b7280;">${escapeHtml(channel.role)}</small>`;
                        btn.onclick = function () {
                            selectedChatId = channel.id;
                            if (chatContactName) chatContactName.textContent = channel.name;
                            renderChatThreadLogs();
                        };
                        chatSidebar.appendChild(btn);
                    });
                    if (!selectedChatId && staticChannels.length > 0) {
                        selectedChatId = staticChannels[0].id;
                        if (chatContactName) chatContactName.textContent = staticChannels[0].name;
                    }
                }
                renderChatThreadLogs();
            }

            function renderChatThreadLogs() {
                if (!chatWindow || !selectedChatId) return;
                const db = loadMasterChatDb();
                chatWindow.innerHTML = '';

                const currentPatientName = (profile.name || '').trim();
                const selectedContact = (selectedChatId || '').trim();
                const isHelpDeskThread = selectedContact === 'Help Desk';

                const visibleLogs = db.filter((m) => {
                    const messagePatientName = (m.patientName || '').trim();
                    const receiverId = (m.receiverId || '').trim();

                    if (isMedicalResponder) {
                        if (isHelpDeskThread) {
                            return messagePatientName === 'Help Desk' || receiverId === 'Help Desk';
                        }
                        return messagePatientName === selectedContact || receiverId === selectedContact || messagePatientName === currentPatientName || receiverId === currentPatientName;
                    }

                    if (isHelpDeskThread) {
                        return messagePatientName === currentPatientName && (receiverId === 'Help Desk' || receiverId === 'Admin');
                    }

                    return (
                        (messagePatientName === currentPatientName && (receiverId === selectedContact || receiverId === 'Admin' || receiverId === currentPatientName || receiverId === 'Help Desk')) ||
                        (messagePatientName === selectedContact && (receiverId === currentPatientName || receiverId === 'Admin' || receiverId === selectedContact))
                    );
                });

                visibleLogs.forEach((msg) => {
                    const wrapper = document.createElement('div');
                    let isMe = false;
                    if (isMedicalResponder && msg.direction === 'responder-to-patient') isMe = true;
                    if (!isMedicalResponder && msg.direction === 'patient-to-responder') isMe = true;

                    wrapper.className = 'chat-message-wrapper ' + (isMe ? 'sender-me' : 'sender-them');

                    if (msg.replyTo) {
                        const replyNote = document.createElement('div');
                        replyNote.style.cssText = 'font-size: 0.75rem; color: #a1a1aa; margin-bottom: 0.15rem;';
                        replyNote.textContent = 'Replying to: ' + msg.replyTo;
                        wrapper.appendChild(replyNote);
                    }

                    const senderName = document.createElement('div');
                    senderName.className = 'chat-sender-name';
                    senderName.textContent = isMe ? (profile.name || 'You') : (selectedContact || 'Contact');
                    wrapper.appendChild(senderName);

                    const bubble = document.createElement('div');
                    bubble.className = 'chat-message ' + (isMe ? 'sender-me' : 'sender-them');
                    bubble.textContent = msg.text;

                    const dropdownContainer = document.createElement('div');
                    dropdownContainer.className = 'msg-dropdown-container';

                    const dotBtn = document.createElement('button');
                    dotBtn.className = 'msg-dropdown-trigger';
                    dotBtn.textContent = '⋯';
                    dotBtn.type = 'button';
                    dotBtn.onclick = (e) => {
                        e.stopPropagation();
                        const wasOpen = menu.classList.contains('show');
                        closeAllDropdowns();
                        if (!wasOpen) menu.classList.add('show');
                    };

                    const menu = document.createElement('div');
                    menu.className = 'msg-dropdown-menu';

                    const optReply = document.createElement('button');
                    optReply.className = 'msg-dropdown-item';
                    optReply.textContent = 'Reply';
                    optReply.onclick = () => {
                        replyTarget = msg;
                        if (replyPreviewText) replyPreviewText.textContent = 'Replying to: ' + msg.text;
                        replyPreview.hidden = false;
                        chatInput.focus();
                    };

                    const optCopy = document.createElement('button');
                    optCopy.className = 'msg-dropdown-item';
                    optCopy.textContent = 'Copy';
                    optCopy.onclick = () => {
                        navigator.clipboard.writeText(msg.text);
                        alert('Copied to clipboard.');
                    };

                    const optForward = document.createElement('button');
                    optForward.className = 'msg-dropdown-item';
                    optForward.textContent = 'Forward';
                    optForward.onclick = () => {
                        const recipient = prompt('Forward to which contact?', 'Admin');
                        const normalizedRecipient = (recipient || '').trim();
                        if (!normalizedRecipient) return;
                        ensurePatientRecord(normalizedRecipient);
                        const masterDb = loadMasterChatDb();
                        const receiverId = normalizedRecipient === 'Admin' ? 'Admin' : (normalizedRecipient || 'Admin');
                        masterDb.push({
                            timestamp: Date.now(),
                            createdAt: Date.now(),
                            text: '[Forwarded] ' + msg.text,
                            patientName: normalizedRecipient,
                            receiverId: receiverId,
                            direction: isMedicalResponder ? 'responder-to-patient' : 'patient-to-responder'
                        });
                        saveMasterChatDb(masterDb);
                        alert('Message forwarded to ' + normalizedRecipient + '.');
                        renderChatThreadLogs();
                        renderCareDashboard();
                    };

                    const optUnsend = document.createElement('button');
                    optUnsend.className = 'msg-dropdown-item delete-action';
                    optUnsend.textContent = 'Unsend';
                    optUnsend.onclick = () => {
                        if (confirm('Unsend this message record permanently?')) {
                            let masterDb = loadMasterChatDb();
                            masterDb = masterDb.filter(m => (m.createdAt || m.timestamp) !== (msg.createdAt || msg.timestamp));
                            saveMasterChatDb(masterDb);
                            renderChatThreadLogs();
                            renderCareDashboard();
                        }
                    };

                    menu.appendChild(optReply);
                    menu.appendChild(optCopy);
                    menu.appendChild(optForward);
                    if (isMe) menu.appendChild(optUnsend);

                    dropdownContainer.appendChild(dotBtn);
                    dropdownContainer.appendChild(menu);

                    const bubbleShell = document.createElement('div');
                    bubbleShell.className = 'chat-bubble-shell';
                    bubbleShell.appendChild(bubble);
                    bubbleShell.appendChild(dropdownContainer);
                    wrapper.appendChild(bubbleShell);
                    const timeStamp = document.createElement('div');
                    timeStamp.className = 'chat-time';
                    timeStamp.textContent = formatTimestamp(msg.createdAt || msg.timestamp);
                    wrapper.appendChild(timeStamp);
                    chatWindow.appendChild(wrapper);
                });
                chatWindow.scrollTop = chatWindow.scrollHeight;
            }

            if (chatForm) {
                chatForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    const text = chatInput.value.trim();
                    if (!text || !selectedChatId) return;

                    const isHelpDeskReply = selectedChatId === 'Help Desk' && isMedicalResponder && !isAdminMode;
                    if (isHelpDeskReply) {
                        alert('Only the admin can respond to Help Desk inquiries.');
                        return;
                    }

                    const db = loadMasterChatDb();
                    let newMsg = {
                        timestamp: Date.now(),
                        createdAt: Date.now(),
                        text: text,
                        replyTo: replyTarget ? replyTarget.text : null
                    };

                    if (isMedicalResponder) {
                        newMsg.patientName = selectedChatId === 'Help Desk' ? 'Help Desk' : selectedChatId;
                        newMsg.receiverId = selectedChatId === 'Help Desk' ? 'Help Desk' : (profile.name || 'Admin');
                        newMsg.direction = 'responder-to-patient';
                    } else {
                        ensurePatientRecord(profile.name);
                        newMsg.patientName = profile.name;
                        newMsg.receiverId = selectedChatId === 'Help Desk' ? 'Help Desk' : selectedChatId;
                        newMsg.direction = 'patient-to-responder';
                    }

                    db.push(newMsg);
                    saveMasterChatDb(db);
                    
                    chatInput.value = '';
                    replyTarget = null;
                    if (replyPreview) replyPreview.hidden = true;
                    renderChatThreadLogs();
                    renderCareDashboard();
                });
            }

            if (careChatForm && careChatInput) {
                careChatForm.addEventListener('submit', function (event) {
                    event.preventDefault();
                    if (isAdminMode) {
                        alert('Personal care chats are hidden in admin view.');
                        return;
                    }
                    const text = careChatInput.value.trim();
                    if (!text || !selectedCarePatient) return;
                    const db = loadMasterChatDb();
                    db.push({
                        timestamp: Date.now(),
                        createdAt: Date.now(),
                        text: text,
                        patientName: selectedCarePatient,
                        receiverId: 'Help Desk',
                        direction: 'responder-to-patient'
                    });
                    saveMasterChatDb(db);
                    careChatInput.value = '';
                    renderCareDashboard();
                });
            }

            if (cancelReplyButton) {
                cancelReplyButton.addEventListener('click', () => {
                    replyTarget = null;
                    if (replyPreview) replyPreview.hidden = true;
                });
            }

            window.evaluateVerificationRequest = function(email, action) {
                let pendingDb = JSON.parse(localStorage.getItem('optiScanPendingRegistrations') || '[]');
                let userDb = JSON.parse(localStorage.getItem('optiScanUsers') || '[]');
                
                const requestIndex = pendingDb.findIndex(p => p.email === email);
                if (requestIndex === -1) return;
                
                const targetRequest = pendingDb[requestIndex];

                if(action === 'approve') {
                    userDb.push({
                        name: targetRequest.name,
                        email: targetRequest.email,
                        password: targetRequest.password,
                        role: targetRequest.role,
                        isQualified: Boolean(targetRequest.isQualified),
                        qualifications: targetRequest.qualifications || '',
                        registeredAt: Date.now()
                    });
                    localStorage.setItem('optiScanUsers', JSON.stringify(userDb));
                    alert(`Account access for ${targetRequest.name} successfully approved.`);
                } else {
                    alert(`Application request for ${targetRequest.name} rejected and dropped.`);
                }

                pendingDb.splice(requestIndex, 1);
                localStorage.setItem('optiScanPendingRegistrations', JSON.stringify(pendingDb));
                renderAdminPanels();
            };

            window.deleteActiveAccount = function(email) {
                if(confirm(`Are you absolutely sure you want to delete this inactive account instance (${email})?`)) {
                    let userDb = JSON.parse(localStorage.getItem('optiScanUsers') || '[]');
                    userDb = userDb.filter(u => u.email !== email);
                    localStorage.setItem('optiScanUsers', JSON.stringify(userDb));
                    renderAdminPanels();
                }
            };

            function renderAdminPanels() {
                if (!isAdminMode) return;

                const verificationQueueList = document.getElementById('verificationQueueList');
                if (verificationQueueList) {
                    const pendingDb = JSON.parse(localStorage.getItem('optiScanPendingRegistrations') || '[]');
                    verificationQueueList.innerHTML = '';

                    if(pendingDb.length === 0) {
                        verificationQueueList.innerHTML = '<p style="color:#6b7280; font-size:0.9rem; padding:1rem; text-align:center; background:#f3f4f6; border-radius:6px;">No registration approvals pending.</p>';
                    } else {
                        pendingDb.forEach(req => {
                            const container = document.createElement('div');
                            container.className = 'verification-card';

                            const nameRow = document.createElement('div');
                            nameRow.innerHTML = '<strong>Applicant Name:</strong> ' + escapeHtml(req.name || '');
                            container.appendChild(nameRow);

                            const emailRow = document.createElement('div');
                            emailRow.innerHTML = '<strong>Email Reference:</strong> ' + escapeHtml(req.email || '');
                            container.appendChild(emailRow);

                            const roleRow = document.createElement('div');
                            roleRow.innerHTML = '<strong>Track Role Request:</strong> <span style="color:#800020; font-weight:600;">' + escapeHtml(req.role || '') + '</span>';
                            container.appendChild(roleRow);

                            const documentLabel = document.createElement('div');
                            documentLabel.style.marginTop = '0.5rem';
                            documentLabel.innerHTML = '<strong>Uploaded Credential Document:</strong>';
                            container.appendChild(documentLabel);

                            const preview = document.createElement('img');
                            const licenseSrc = String(req.licenseImage || '').startsWith('/api/licenses/')
                                ? req.licenseImage
                                : (req.licenseImage ? `/api/licenses/${encodeURIComponent(req.licenseImage.replace(/^\.?\.?\/?/, ''))}` : '');
                            preview.src = licenseSrc;
                            preview.alt = 'License Verification';
                            preview.className = 'license-preview-img';
                            container.appendChild(preview);

                            const actionRow = document.createElement('div');
                            actionRow.className = 'admin-action-row';

                            const approveBtn = document.createElement('button');
                            approveBtn.className = 'btn-approve';
                            approveBtn.textContent = 'Approve / Activate';
                            approveBtn.onclick = function () {
                                evaluateVerificationRequest(req.email, 'approve');
                            };
                            actionRow.appendChild(approveBtn);

                            const rejectBtn = document.createElement('button');
                            rejectBtn.className = 'btn-reject';
                            rejectBtn.textContent = 'Reject Application';
                            rejectBtn.onclick = function () {
                                evaluateVerificationRequest(req.email, 'reject');
                            };
                            actionRow.appendChild(rejectBtn);

                            container.appendChild(actionRow);
                            verificationQueueList.appendChild(container);
                        });
                    }
                }

                const userListContainer = document.getElementById('userList');
                if (userListContainer) {
                    let allUsers = getRegisteredUsers();
                    if (!Array.isArray(allUsers)) allUsers = [];
                    const defaultUsers = getDefaultRegisteredUsers();
                    defaultUsers.forEach(function (defaultUser) {
                        if (!allUsers.some(user => (user.email || '').toLowerCase() === (defaultUser.email || '').toLowerCase())) {
                            allUsers.unshift(defaultUser);
                        }
                    });
                    localStorage.setItem('optiScanUsers', JSON.stringify(allUsers));
                    const currentSessionUser = JSON.parse(localStorage.getItem('optiScanCurrentUser') || 'null');
                    if (currentSessionUser && currentSessionUser.email && !allUsers.some(user => (user.email || '').toLowerCase() === (currentSessionUser.email || '').toLowerCase())) {
                        allUsers.unshift(currentSessionUser);
                        localStorage.setItem('optiScanUsers', JSON.stringify(allUsers));
                    }
                    userListContainer.innerHTML = '';
                    
                    if(allUsers.length === 0) {
                        userListContainer.innerHTML = '<p style="color:#9ca3af; font-size:0.85rem;">No records present.</p>';
                    } else {
                        allUsers.forEach(u => {
                            const row = document.createElement('div');
                            row.style.cssText = 'padding:0.6rem; border-bottom:1px solid #e5e7eb; font-size:0.9rem; display:flex; justify-content:between; align-items:center; width:100%; box-sizing:border-box;';

                            const info = document.createElement('div');
                            info.style.flex = '1';
                            const title = document.createElement('strong');
                            title.textContent = 'User Instance';
                            info.appendChild(title);
                            info.appendChild(document.createTextNode(' - Profile ID Verified '));
                            const roleBadge = document.createElement('span');
                            roleBadge.style.color = '#800020';
                            roleBadge.textContent = '(' + (u.role || 'patient') + ')';
                            info.appendChild(roleBadge);
                            info.appendChild(document.createElement('br'));
                            const contact = document.createElement('small');
                            contact.style.color = '#6b7280';
                            contact.textContent = 'Contact: ' + (u.email || '');
                            info.appendChild(contact);
                            row.appendChild(info);

                            const deleteBtn = document.createElement('button');
                            deleteBtn.className = 'btn-delete';
                            deleteBtn.textContent = 'Delete Account';
                            deleteBtn.onclick = function () {
                                deleteActiveAccount(u.email);
                            };
                            row.appendChild(deleteBtn);

                            userListContainer.appendChild(row);
                        });
                    }
                }
            }

            await syncRegisteredAccountsFromServer();
            cleanupSamplePatientData();
            rebuildSidebarChannels();
            renderCareDashboard();
            renderDoctorDirectory();

            document.querySelectorAll('.tab-btn[data-target]').forEach(button => {
                button.addEventListener('click', () => {
                    const targetId = button.getAttribute('data-target');
                    if (!targetId) return;

                    document.querySelectorAll('.tab-btn[data-target]').forEach(tab => tab.classList.remove('active'));
                    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
                    button.classList.add('active');

                    const targetPanel = document.getElementById(targetId);
                    if (targetPanel) {
                        targetPanel.classList.add('active');
                        if (targetId === 'scanner' && activeStream && video) {
                            setTimeout(() => {
                                video.play().catch(() => {});
                            }, 80);
                        }
                    }

                    if (targetId === 'home') renderDoctorDirectory();
                    if (targetId === 'chats') rebuildSidebarChannels();
                    if (targetId === 'care') renderCareDashboard();
                    if (targetId === 'admin') renderAdminPanels();
                });
            });

            if (isAdminMode) {
                const adminTabBtn = document.getElementById('adminTabBtn');
                if (adminTabBtn) adminTabBtn.hidden = false;
                renderAdminPanels();
            }

            applyDiagnosisAccess();

            if (logoutLink) {
                logoutLink.onclick = (e) => logoutFromDashboard(e);
                logoutLink.addEventListener('click', (e) => logoutFromDashboard(e));
            }
        });
    const video = document.getElementById('scannerVideo');
    const startBtn = document.getElementById('startCameraBtn');
    const captureBtn = document.getElementById('capturePhotoBtn');
    const clearGalleryBtn = document.getElementById('clearGalleryBtn');
    const enhanceCameraBtn = document.getElementById('enhanceCameraBtn');
    const aiAnalyzeBtn = document.getElementById('aiAnalyzeBtn');
    const gallery = document.getElementById('gallery');
    const scannerStatus = document.getElementById('scannerStatus');
    const cameraQualityStatus = document.getElementById('cameraQualityStatus');
    const aiAnalysisOutput = document.getElementById('aiAnalysisOutput');
    const diagnosisAccessNotice = document.getElementById('diagnosisAccessNotice');
    const capturedImages = [];
    let activeStream = null;

    function applyDiagnosisAccess() {
        const canUseDiagnosisTools = isAdminMode || (currentRole === 'medical-professional' && isQualifiedProfessional);
        if (enhanceCameraBtn) enhanceCameraBtn.disabled = !canUseDiagnosisTools;
        if (aiAnalyzeBtn) aiAnalyzeBtn.disabled = !canUseDiagnosisTools;
        if (diagnosisAccessNotice) {
            diagnosisAccessNotice.style.display = canUseDiagnosisTools ? 'none' : 'block';
        }
        if (!canUseDiagnosisTools && aiAnalysisOutput) {
            aiAnalysisOutput.innerHTML = '<div style="color:#991b1b; font-weight:600;">Only qualified medical professionals can run diagnosis-focused assessments.</div>';
            if (cameraQualityStatus) {
                cameraQualityStatus.textContent = 'Diagnosis access restricted to qualified medical professionals.';
            }
        }
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function analyzeEyeImageFromVideo() {
        if (!video || !video.videoWidth || !video.videoHeight) {
            return {
                qualityScore: 0,
                qualityLabel: 'Camera not ready',
                diagnosis: 'Camera preview is not ready yet. Start the camera and try again.',
                suggestion: 'Ensure the eye is in frame and lighting is stable.'
            };
        }

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext('2d');
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height).data;

        let brightnessTotal = 0;
        let contrastTotal = 0;
        let redTotal = 0;
        let greenTotal = 0;
        let blueTotal = 0;
        const sampleCount = imageData.length / 4;

        for (let index = 0; index < imageData.length; index += 4) {
            const r = imageData[index];
            const g = imageData[index + 1];
            const b = imageData[index + 2];
            const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            brightnessTotal += luminance;
            redTotal += r;
            greenTotal += g;
            blueTotal += b;
            contrastTotal += Math.abs((r - g) + (r - b)) / 255;
        }

        const averageBrightness = brightnessTotal / sampleCount;
        const averageContrast = contrastTotal / sampleCount;
        const redRatio = redTotal / (greenTotal + blueTotal + 1);
        const qualityScore = clamp(Math.round((averageContrast * 80) + (averageBrightness > 0.28 && averageBrightness < 0.8 ? 20 : 5)), 0, 100);
        let qualityLabel = qualityScore >= 80 ? 'Excellent' : qualityScore >= 60 ? 'Good' : qualityScore >= 40 ? 'Fair' : 'Needs adjustment';
        let diagnosis = 'Initial AI review suggests the eye is visible and the scan is suitable for follow-up review.';
        let suggestion = 'Keep the eye centered and maintain steady framing.';

        if (averageBrightness < 0.25) {
            diagnosis = 'Low-light preview detected. Increase lighting before scanning.';
            suggestion = 'Brighten the environment and avoid shadows around the eye.';
        } else if (averageBrightness > 0.78) {
            diagnosis = 'The preview is overly bright, which may cause glare and reduce detail.';
            suggestion = 'Reduce direct light glare and keep the camera slightly farther away.';
        } else if (averageContrast < 0.12) {
            diagnosis = 'The image looks soft or blurry. Focus the lens and reduce motion.';
            suggestion = 'Hold still and move the camera closer until the pupil is sharp.';
        } else if (redRatio > 1.35) {
            diagnosis = 'Possible redness or irritation is suggested by the captured color profile.';
            suggestion = 'Check for dryness or irritation and keep the eye well-lit.';
        } else {
            diagnosis = 'Initial AI review suggests a generally clear view of the eye surface.';
            suggestion = 'Continue with the scan and keep the camera steady.';
        }

        return {
            qualityScore,
            qualityLabel,
            diagnosis,
            suggestion
        };
    }

    function renderAiAnalysis() {
        if (!video || !video.videoWidth || !video.videoHeight || !video.srcObject) {
            setScannerStatus('Camera preview is not ready yet. Start the camera and try again.', true);
            return;
        }

        const analysis = analyzeEyeImageFromVideo();
        if (cameraQualityStatus) {
            cameraQualityStatus.textContent = `Camera quality: ${analysis.qualityLabel} (${analysis.qualityScore}/100)`;
        }
        if (aiAnalysisOutput) {
            aiAnalysisOutput.innerHTML = `
                <div><strong>Initial AI review:</strong> ${escapeHtml(analysis.diagnosis)}</div>
                <div style="margin-top: 0.35rem;"><strong>Camera quality:</strong> ${escapeHtml(analysis.qualityLabel)} (${escapeHtml(analysis.qualityScore)}/100)</div>
                <div style="margin-top: 0.35rem;"><strong>Suggestion:</strong> ${escapeHtml(analysis.suggestion)}</div>
                <div style="margin-top: 0.45rem; font-size: 0.8rem; color: #6b7280;">This is a heuristic preview assessment and not a medical diagnosis.</div>
            `;
        }
    }

    function setScannerStatus(message, isError) {
        if (scannerStatus) {
            scannerStatus.textContent = message;
        }
        if (isError && aiAnalysisOutput) {
            aiAnalysisOutput.innerHTML = `<div style="color:#991b1b; font-weight:600;">${escapeHtml(message)}</div>`;
        }
    }

    function getCameraAccessMethod() {
        const mediaDevices = navigator.mediaDevices || {};
        if (typeof mediaDevices.getUserMedia === 'function') return mediaDevices.getUserMedia.bind(mediaDevices);
        if (typeof navigator.getUserMedia === 'function') return navigator.getUserMedia.bind(navigator);
        if (typeof navigator.webkitGetUserMedia === 'function') return navigator.webkitGetUserMedia.bind(navigator);
        if (typeof navigator.mozGetUserMedia === 'function') return navigator.mozGetUserMedia.bind(navigator);
        return null;
    }

    async function connectRemoteEsp32Camera() {
        try {
            const response = await fetch('/api/esp32/health', { credentials: 'same-origin' });
            const payload = await response.json();
            if (!response.ok || !payload || !payload.ok) {
                throw new Error(payload && payload.error ? payload.error : 'ESP32 camera unavailable.');
            }

            if (video) {
                video.src = '/api/esp32/capture?ts=' + Date.now();
                video.setAttribute('playsinline', 'true');
                video.setAttribute('autoplay', 'true');
                video.loop = true;
                video.muted = true;
                video.poster = '/api/esp32/capture?ts=' + Date.now();
            }

            if (startBtn) startBtn.textContent = 'Stop Camera';
            setScannerStatus('Connected to ESP32-CAM at 192.168.254.186.');
            return true;
        } catch (error) {
            return false;
        }
    }

    function requestCameraAccess(constraints) {
        const cameraAccessMethod = getCameraAccessMethod();
        if (!cameraAccessMethod) {
            return Promise.reject(new Error('Camera access is not supported in this browser environment.'));
        }

        try {
            const result = cameraAccessMethod(constraints);
            if (result && typeof result.then === 'function') {
                return result;
            }
        } catch (error) {
            return Promise.reject(error);
        }

        return new Promise((resolve, reject) => {
            try {
                cameraAccessMethod(constraints, resolve, reject);
            } catch (error) {
                reject(error);
            }
        });
    }

    function stopCamera() {
        if (activeStream) {
            activeStream.getTracks().forEach(track => track.stop());
            activeStream = null;
        }
        if (video) {
            video.srcObject = null;
            video.pause();
        }
        if (startBtn) {
            startBtn.textContent = 'Start Camera';
        }
        if (scannerStatus) {
            scannerStatus.textContent = 'Camera stopped.';
        }
        if (video) {
            video.style.filter = 'none';
        }
    }

    if (video) {
        video.setAttribute('playsinline', 'true');
        video.setAttribute('autoplay', 'true');
        video.setAttribute('muted', 'true');
    }

    if (startBtn) {
        startBtn.addEventListener('click', async () => {
            if (activeStream) {
                stopCamera();
                return;
            }

            try {
                try {
                    activeStream = await requestCameraAccess({
                        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
                    });
                    if (video) {
                        video.srcObject = activeStream;
                        video.onloadedmetadata = () => {
                            video.play().catch(() => {});
                        };
                    }
                    if (startBtn) {
                        startBtn.textContent = 'Stop Camera';
                    }
                    setScannerStatus('Camera live. Capture as many images as you need.');
                    renderAiAnalysis();
                    return;
                } catch (browserError) {
                    const connected = await connectRemoteEsp32Camera();
                    if (!connected) {
                        throw browserError;
                    }
                }
            } catch (err) {
                const message = err && err.message ? err.message : 'Camera access was blocked or unavailable.';
                setScannerStatus(message, true);
                alert('Camera error: ' + message);
            }
        });
    }

    if (captureBtn) {
        captureBtn.addEventListener('click', () => {
            if (!video || !video.srcObject) {
                if (scannerStatus) scannerStatus.textContent = 'Start the camera first.';
                alert('Start the camera first!');
                return;
            }

            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth || 640;
            canvas.height = video.videoHeight || 480;
            const context = canvas.getContext('2d');
            context.drawImage(video, 0, 0, canvas.width, canvas.height);

            const img = document.createElement('img');
            img.src = canvas.toDataURL('image/png');
            img.alt = 'Captured scan ' + (capturedImages.length + 1);
            img.className = 'capture-thumb';
            img.title = 'Captured image ' + (capturedImages.length + 1);
            if (gallery) {
                gallery.appendChild(img);
            }
            capturedImages.push(img.src);
            window.optiscanLatestCapturedImage = img.src;
            if (scannerStatus) {
                scannerStatus.textContent = 'Captured image ' + capturedImages.length + '.';
            }
            renderAiAnalysis();
        });
    }

    if (clearGalleryBtn) {
        clearGalleryBtn.addEventListener('click', () => {
            capturedImages.length = 0;
            window.optiscanLatestCapturedImage = null;
            if (gallery) gallery.innerHTML = '';
            if (scannerStatus) scannerStatus.textContent = 'Gallery cleared.';
        });
    }

    if (enhanceCameraBtn) {
        enhanceCameraBtn.addEventListener('click', () => {
            if (video) {
                video.style.filter = 'contrast(1.2) saturate(1.1) brightness(1.08)';
            }
            if (scannerStatus) {
                scannerStatus.textContent = 'Preview enhanced for clearer eye detail. Keep the eye steady.';
            }
            renderAiAnalysis();
        });
    }

    if (aiAnalyzeBtn && aiAnalyzeBtn.dataset.aiApi !== 'true') {
        aiAnalyzeBtn.addEventListener('click', renderAiAnalysis);
    }

    window.addEventListener('beforeunload', stopCamera);
