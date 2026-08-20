(function () {
  const body = document.body;
  let currentRole = 'patient';
  let isAdminMode = false;
  let isQualifiedProfessional = false;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
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
    const settingsThemeSelect = document.getElementById('settingsThemeSelect');
    const settingsFontSelect = document.getElementById('settingsFontSelect');
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    const logoutLink = document.getElementById('logoutLink');
    if (logoutLink) {
      logoutLink.addEventListener('click', logoutFromDashboard);
    }

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
    const profileNameInput = document.getElementById('profile-name-input');
    const profileRoleBadge = document.getElementById('profile-role');
    const profileBirthdateInput = document.getElementById('profile-birthdate');
    const profileAgeInput = document.getElementById('profile-age');
    const profileHistoryInput = document.getElementById('profile-history');
    const saveProfileButton = document.getElementById('saveProfileBtn');
    const deleteAccountButton = document.getElementById('deleteAccountBtn');
    const doctorProfileFields = document.getElementById('doctorProfileFields');
    const chatForm = document.getElementById('chatForm');
    const chatInput = document.getElementById('chatInput');
    const chatWindow = document.getElementById('chatWindow');
    const chatSidebar = document.getElementById('chatSidebar');
    const chatContactName = document.getElementById('chatContactName');
    const replyPreview = document.getElementById('replyPreview');
    const replyPreviewText = document.getElementById('replyPreviewText');
    const cancelReplyButton = document.getElementById('cancelReplyBtn');
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
        return (Array.isArray(allUsers) ? allUsers : []).filter((user) => (user.role || '').toLowerCase() === 'medical-professional' && (user.isQualified || (user.qualifications || '').trim())).map((user) => ({
          name: user.name || 'Dr. Unknown',
          qualifications: user.qualifications || '',
          hospital: '',
          location: '',
          email: user.email || '',
          phone: ''
        }));
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
      doctors.forEach((doctor) => {
        const card = document.createElement('div');
        card.style.cssText = 'padding: 0.8rem; border: 1px solid #e5e7eb; border-radius: 8px; background: #f9fafb;';
        card.innerHTML = `<strong style="color:#800020; display:block; margin-bottom:0.2rem;">${escapeHtml(doctor.name || 'Dr. Unknown')}</strong><div style="font-size:0.9rem; color:#4b5563;">${escapeHtml(doctor.qualifications || 'Specialist')}</div><div style="font-size:0.84rem; color:#800020; margin-top:0.2rem;"><strong>Email:</strong> ${escapeHtml(doctor.email || 'Not provided')}</div>`;
        container.appendChild(card);
      });
    }

    const userSuffix = storedUser && storedUser.email ? '_' + btoa(storedUser.email) : '';
    const profileStorageKey = 'optiScanProfile' + userSuffix;
    const defaultProfile = {
      name: name || (storedUser ? storedUser.name : 'Guest'),
      birthdate: storedUser && storedUser.birthdate ? storedUser.birthdate : '',
      age: '',
      medicalHistory: isAdminMode ? 'Root access cleared.' : 'No major complications reported.',
      qualifications: '',
      hospital: '',
      location: '',
      doctorEmail: '',
      doctorPhone: ''
    };
    let profile = Object.assign({}, defaultProfile, JSON.parse(localStorage.getItem(profileStorageKey) || '{}'));

    function calculateAge(birthdate) {
      if (!birthdate) return '';
      const birth = new Date(birthdate);
      const today = new Date();
      let age = today.getFullYear() - birth.getFullYear();
      if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age--;
      return age;
    }

    if (doctorProfileFields) {
      doctorProfileFields.style.display = currentRole === 'medical-professional' ? 'flex' : 'none';
    }

    if (heading) {
      const roleLabel = currentRole === 'medical-professional' ? (isQualifiedProfessional ? 'Medical Professional' : 'Medical Professional (Pending Qualification)') : (currentRole === 'admin' ? 'Administrator' : 'Patient');
      heading.textContent = `Welcome, ${profile.name} (${roleLabel})!`;
    }
    if (profileNameInput) profileNameInput.value = (profile.name === 'Guest') ? '' : profile.name;
    if (profileBirthdateInput) profileBirthdateInput.value = profile.birthdate;
    if (profileAgeInput) profileAgeInput.value = profile.age;
    if (profileHistoryInput) profileHistoryInput.value = profile.medicalHistory;
    if (profileRoleBadge) {
      profileRoleBadge.textContent = currentRole === 'medical-professional' ? (isQualifiedProfessional ? 'Medical Professional (Qualified)' : 'Medical Professional (Pending Qualification)') : (currentRole === 'admin' ? 'Administrator' : 'Patient');
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
        localStorage.setItem(profileStorageKey, JSON.stringify(profile));
        alert('Profile configuration updated successfully.');
      });
    }

    if (deleteAccountButton) {
      deleteAccountButton.addEventListener('click', async () => {
        const currentUser = getStoredUser();
        if (!currentUser || !currentUser.email) {
          alert('You must be signed in to delete your account.');
          return;
        }

        const confirmed = window.confirm('Are you sure you want to delete your account? This will permanently remove your account, profile, chats, patient records, and access. OK to continue, or Cancel to keep your account.');
        if (!confirmed) return;

        try {
          const response = await fetch('/api/delete-account', {
            method: 'POST',
            credentials: 'include'
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(data.error || 'Unable to delete account.');
          }
          localStorage.removeItem('optiScanCurrentUser');
          window.location.href = 'OptiScan.html';
        } catch (error) {
          alert(error.message || 'Unable to delete account.');
        }
      });
    }

    function renderChatSidebar() {
      if (!chatSidebar) return;
      const contacts = [
        { id: 'doc-1', name: 'Dr. Reyes', subtitle: 'Optometry' },
        { id: 'doc-2', name: 'Dr. Santos', subtitle: 'Retina' }
      ];
      chatSidebar.innerHTML = '';
      contacts.forEach((contact) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tab-btn';
        button.style.cssText = 'text-align:left; width:100%; margin-bottom:0.35rem;';
        button.textContent = `${contact.name} · ${contact.subtitle}`;
        button.addEventListener('click', () => {
          selectedChatId = contact.id;
          if (chatContactName) chatContactName.textContent = contact.name;
          if (chatWindow) {
            chatWindow.innerHTML = `<div class="chat-message-wrapper sender-them"><div class="chat-message sender-them">Hello, this is ${escapeHtml(contact.name)}.</div></div>`;
          }
        });
        chatSidebar.appendChild(button);
      });
    }

    function renderCareView() {
      if (!carePatientList || !carePatientName || !carePatientProfile || !careChatWindow || !careChatForm || !careChatInput) return;
      const patients = [{ name: 'A. Cruz', status: 'pending', info: 'Needs follow-up' }, { name: 'M. Lee', status: 'accepted', info: 'Stable' }];
      carePatientList.innerHTML = '';
      patients.forEach((patient) => {
        const row = document.createElement('div');
        row.className = 'care-patient-row';
        row.innerHTML = `<button type="button" class="care-patient-btn">${escapeHtml(patient.name)}<div class="care-patient-status ${escapeHtml(patient.status)}">${escapeHtml(patient.status)}</div></button>`;
        row.querySelector('button').addEventListener('click', () => {
          selectedCarePatient = patient;
          carePatientName.textContent = patient.name;
          carePatientProfile.innerHTML = `<div class="care-info-row"><span>Condition</span><strong>${escapeHtml(patient.info)}</strong></div>`;
          careChatWindow.innerHTML = `<div class="care-chat-entry">Care summary for ${escapeHtml(patient.name)}.</div>`;
        });
        carePatientList.appendChild(row);
      });
      if (!selectedCarePatient && patients.length) {
        const first = patients[0];
        selectedCarePatient = first;
        carePatientName.textContent = first.name;
        carePatientProfile.innerHTML = `<div class="care-info-row"><span>Condition</span><strong>${escapeHtml(first.info)}</strong></div>`;
        careChatWindow.innerHTML = `<div class="care-chat-entry">Care summary for ${escapeHtml(first.name)}.</div>`;
      }
    }

    if (chatForm && chatInput && chatWindow) {
      chatForm.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!chatInput.value.trim()) return;
        const wrapper = document.createElement('div');
        wrapper.className = 'chat-message-wrapper sender-me';
        wrapper.innerHTML = `<div class="chat-message sender-me">${escapeHtml(chatInput.value)}</div>`;
        chatWindow.appendChild(wrapper);
        chatInput.value = '';
      });
    }

    if (careChatForm && careChatInput && careChatWindow) {
      careChatForm.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!careChatInput.value.trim()) return;
        careChatWindow.insertAdjacentHTML('beforeend', `<div class="care-chat-entry">${escapeHtml(careChatInput.value)}</div>`);
        careChatInput.value = '';
      });
    }

    renderDoctorDirectory();
    renderChatSidebar();
    renderCareView();
  });
})();
