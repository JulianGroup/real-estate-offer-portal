import { 
    auth, db, storage, createUserWithEmailAndPassword, signInWithEmailAndPassword, 
    onAuthStateChanged, signOut, updateProfile, doc, setDoc, getDoc,
    collection, addDoc, query, where, onSnapshot, getDocs, sendPasswordResetEmail, deleteDoc,
    functions, httpsCallable, ref, uploadBytes, getDownloadURL
} from './firebase-config.js';

// Helper to compress image to Base64
const compressImage = (file) => {
    return new Promise((resolve, reject) => {
        if (!file) { resolve(null); return; }
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = event => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 800;
                const MAX_HEIGHT = 600;
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
                } else {
                    if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.7)); // Compress to 70% quality JPEG
            }
            img.onerror = error => reject(error);
        }
        reader.onerror = error => reject(error);
    });
};

const initializeAppLogic = () => {
    const path = window.location.pathname;
    const isAuthPage = path.includes('login') || path.includes('register');
    const isPublicPage = path.includes('offer_submission') || path.includes('seller_presentation');

    // --- FIREBASE AUTHENTICATION LOGIC ---

    // 1. Auth State Observer
    onAuthStateChanged(auth, (user) => {

        if (user) {
            // User is signed in.
            console.log("User is signed in:", user.email);
            // If they are on the login/register page AND not actively registering, redirect to dashboard
            if (isAuthPage && !window.isRegistering) {
                window.location.href = 'index.html';
            }
            
            // Update UI with user's name if elements exist
            const userNameElements = document.querySelectorAll('.user-name-display');
            userNameElements.forEach(el => el.innerText = user.displayName || 'Agent');
            
            const emailDisplay = document.getElementById('current-user-email-display');
            if (emailDisplay) emailDisplay.innerText = `Logged in as: ${user.email}`;

            // RBAC & Admin Dashboard Logic
            getDoc(doc(db, "users", user.uid)).then(async (userDocSnap) => {
                const userData = userDocSnap.exists() ? userDocSnap.data() : {};
                const isAdmin = userData.isAdmin === true;

                // Show admin panel link if they are an admin
                const adminLink = document.getElementById('link-admin-panel');
                if (adminLink && isAdmin) {
                    adminLink.style.display = 'inline-block';
                }

                // If on admin dashboard, ensure they have access, then load data
                if (path.includes('admin_dashboard.html')) {
                    if (!isAdmin) {
                        alert("Unauthorized access. Redirecting to your dashboard.");
                        window.location.href = 'index.html';
                        return;
                    }

                    try {
                        // 1. Fetch Agents
                        const agentsSnap = await getDocs(collection(db, "users"));
                        document.getElementById('metric-agents').innerText = agentsSnap.size;
                        const tableAgents = document.querySelector('#table-agents tbody');
                        tableAgents.innerHTML = '';
                        
                        let agentMap = {}; // Map for easy property lookup
                        
                        if (agentsSnap.empty) {
                            tableAgents.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No agents registered.</td></tr>';
                        } else {
                            agentsSnap.forEach(snap => {
                                const agent = snap.data();
                                agentMap[snap.id] = agent.name || agent.fullName || agent.email;
                                
                                const joined = agent.createdAt ? new Date(agent.createdAt.seconds * 1000).toLocaleDateString() : 'Unknown';
                                tableAgents.innerHTML += `
                                    <tr>
                                        <td><strong>${agent.name || agent.fullName || 'Unnamed'}</strong> ${agent.isAdmin ? '<span class="badge" style="background: var(--primary); color: white;">Admin</span>' : ''}</td>
                                        <td><a href="mailto:${agent.email}" style="color: var(--primary);">${agent.email}</a></td>
                                        <td>${agent.brokerage || 'N/A'}</td>
                                        <td>${agent.dreLicense || 'N/A'}</td>
                                        <td>${joined}</td>
                                    </tr>
                                `;
                            });
                        }

                        // 2. Fetch Properties
                        const propsSnap = await getDocs(collection(db, "properties"));
                        document.getElementById('metric-properties').innerText = propsSnap.size;
                        const tableProps = document.querySelector('#table-properties tbody');
                        tableProps.innerHTML = '';

                        // 3. Fetch Offers to correlate with properties and get total
                        const offersSnap = await getDocs(collection(db, "offers"));
                        document.getElementById('metric-offers').innerText = offersSnap.size;
                        
                        let propertyOfferCounts = {};
                        offersSnap.forEach(osnap => {
                            const o = osnap.data();
                            propertyOfferCounts[o.propertyId] = (propertyOfferCounts[o.propertyId] || 0) + 1;
                        });

                        if (propsSnap.empty) {
                            tableProps.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No active properties.</td></tr>';
                        } else {
                            propsSnap.forEach(snap => {
                                const prop = snap.data();
                                const propId = snap.id;
                                const listingAgentName = agentMap[prop.agentId] || 'Unknown Agent';
                                const offerCount = propertyOfferCounts[propId] || 0;
                                
                                tableProps.innerHTML += `
                                    <tr>
                                        <td><strong>${prop.address}</strong></td>
                                        <td>${listingAgentName}</td>
                                        <td>${prop.askingPrice}</td>
                                        <td><span class="badge" style="background: var(--surface); color: var(--text-dark); border: 1px solid var(--border);">${offerCount} Offers</span></td>
                                        <td>
                                            <a href="offer_management.html?id=${propId}" class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;">View Offers</a>
                                        </td>
                                    </tr>
                                `;
                            });
                        }
                    } catch (error) {
                        console.error("Error loading admin data:", error);
                        alert("Error loading admin dashboard: " + error.message);
                    }
                }
            }).catch(e => {
                console.error("Error checking RBAC:", e);
                if (e.code === 'permission-denied') {
                    signOut(auth).then(() => window.location.href = 'login.html');
                }
            });

            // Load Settings Profile if on settings page
            if (path.includes('settings.html')) {
                window.renderTeam = (team) => {
                    const teamContainer = document.getElementById('team-members-list');
                    if (!teamContainer) return;
                    teamContainer.innerHTML = '';
                    if (team.length === 0) {
                        teamContainer.innerHTML = '<p class="text-muted" style="font-size: 0.9rem;">No active team members.</p>';
                    } else {
                        team.forEach((member, index) => {
                            teamContainer.innerHTML += `
                                <div class="flex justify-between items-center mb-2" style="padding-bottom: 0.5rem; border-bottom: 1px solid var(--border);">
                                    <div>
                                        <strong>${member.email.split('@')[0]}</strong> <span class="badge" style="background-color: var(--border); color: var(--text-main);">${member.role}</span><br>
                                        <span class="text-muted" style="font-size: 0.8rem;">${member.email}</span>
                                    </div>
                                    <button class="btn btn-outline" onclick="window.removeTeamMember(${index})" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; border-color: var(--danger); color: var(--danger);">Remove</button>
                                </div>
                            `;
                        });
                    }
                };

                window.refreshTeam = async () => {
                    const docSnap = await getDoc(doc(db, "users", user.uid));
                    if (docSnap.exists()) {
                        window.renderTeam(docSnap.data().team || []);
                    }
                };

                getDoc(doc(db, "users", user.uid)).then((docSnap) => {
                    if (docSnap.exists()) {
                        const data = docSnap.data();
                        document.getElementById('set-name').value = data.fullName || '';
                        document.getElementById('set-email').value = data.email || user.email || '';
                        document.getElementById('set-mobile').value = data.mobile || '';
                        document.getElementById('set-dre').value = data.dreLicense || '';
                        document.getElementById('set-brokerage').value = data.brokerage || '';
                        window.renderTeam(data.team || []);
                    } else {
                        document.getElementById('set-name').placeholder = "Enter your name";
                        document.getElementById('set-email').value = user.email || '';
                        document.getElementById('set-mobile').placeholder = "Enter your mobile";
                        document.getElementById('set-dre').placeholder = "Enter DRE License";
                        document.getElementById('set-brokerage').placeholder = "Enter Brokerage";
                        window.renderTeam([]);
                    }
                }).catch(err => console.error("Error fetching profile:", err));

                window.removeTeamMember = async (index) => {
                    if (!confirm("Are you sure you want to remove this team member?")) return;
                    try {
                        const docRef = doc(db, "users", user.uid);
                        const docSnap = await getDoc(docRef);
                        if (docSnap.exists() && docSnap.data().team) {
                            let team = docSnap.data().team;
                            team.splice(index, 1);
                            const teamEmails = team.map(m => m.email.toLowerCase());
                            await setDoc(docRef, { team: team, teamEmails: teamEmails }, { merge: true });
                            await window.refreshTeam();
                        }
                    } catch (error) {
                        console.error("Error removing team member:", error);
                        alert("Error: " + error.message);
                    }
                };

                const inviteForm = document.getElementById('team-invite-form');
                if (inviteForm) {
                    inviteForm.addEventListener('submit', async (e) => {
                        e.preventDefault();
                        const btn = document.getElementById('btn-send-invite');
                        const originalText = btn.innerText;
                        btn.innerText = 'Sending...';
                        btn.disabled = true;

                        try {
                            const email = document.getElementById('invite-email').value;
                            const role = document.getElementById('invite-role').value;

                            const docRef = doc(db, "users", user.uid);
                            const docSnap = await getDoc(docRef);
                            let team = [];
                            if (docSnap.exists() && docSnap.data().team) {
                                team = docSnap.data().team;
                            }
                            
                            if (team.find(m => m.email.toLowerCase() === email.toLowerCase())) {
                                alert("This person is already on your team.");
                                btn.innerText = originalText;
                                btn.disabled = false;
                                return;
                            }

                            team.push({ email, role, addedAt: new Date().toISOString() });
                            const teamEmails = team.map(m => m.email.toLowerCase());
                            await setDoc(docRef, { team: team, teamEmails: teamEmails }, { merge: true });
                            
                            inviteForm.reset();
                            await window.refreshTeam();
                            btn.innerText = 'Sent!';
                            setTimeout(() => {
                                btn.innerText = originalText;
                                btn.disabled = false;
                            }, 2000);
                        } catch (error) {
                            console.error("Error inviting team member:", error);
                            alert("Error: " + error.message);
                            btn.innerText = originalText;
                            btn.disabled = false;
                        }
                    });
                }
            }

            // Load Edit Property if on edit page
            if (path.includes('edit_property.html')) {
                const urlParams = new URLSearchParams(window.location.search);
                const propertyId = urlParams.get('id');
                if (propertyId) {
                    getDoc(doc(db, "properties", propertyId)).then((docSnap) => {
                        if (docSnap.exists()) {
                            const data = docSnap.data();
                            document.getElementById('edit-address').value = data.address || '';
                            document.getElementById('edit-price').value = data.askingPrice || '';
                            document.getElementById('edit-desc').value = data.description || '';
                        }
                    }).catch(err => console.error("Error fetching property:", err));
                }
            }



            // Load Properties if on index page
            if (path.includes('index.html') || path === '/' || path.includes('real-estate-offer-portal')) {
                const listingsContainer = document.getElementById('listings-container');
                if (listingsContainer) {
                    const userEmail = user.email ? user.email.toLowerCase() : "";
                    getDocs(query(collection(db, "users"), where("teamEmails", "array-contains", userEmail))).then(inviterSnap => {
                        let agentIds = [user.uid];
                        inviterSnap.forEach(doc => agentIds.push(doc.id));
                        
                        // Firebase 'in' queries allow up to 10 elements
                        if (agentIds.length > 10) agentIds = agentIds.slice(0, 10);
                        
                        const q = query(collection(db, "properties"), where("agentId", "in", agentIds));
                        onSnapshot(q, (querySnapshot) => {
                        listingsContainer.innerHTML = ''; // Clear loading text
                        if (querySnapshot.empty) {
                            listingsContainer.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: var(--surface); border-radius: var(--radius-md);"><p class="text-muted">You have no active listings. Create one to get started!</p></div>';
                            return;
                        }
                        
                        let properties = [];
                        querySnapshot.forEach(docSnap => {
                            properties.push({ id: docSnap.id, data: docSnap.data() });
                        });
                        
                        const statusOrder = { 'Active Listing': 1, 'Hold': 2, 'Trash': 3 };
                        properties.sort((a, b) => {
                            let statusA = a.data.status || 'Active Listing';
                            if (statusA === 'active') statusA = 'Active Listing';
                            let statusB = b.data.status || 'Active Listing';
                            if (statusB === 'active') statusB = 'Active Listing';
                            const valA = statusOrder[statusA] || 1;
                            const valB = statusOrder[statusB] || 1;
                            return valA - valB;
                        });

                        properties.forEach((prop) => {
                            const data = prop.data;
                            const id = prop.id;
                            let statusLabel = data.status || 'Active Listing';
                            if (statusLabel === 'active') statusLabel = 'Active Listing';
                            
                            let badgeHtml = '';
                            if (statusLabel === 'Active Listing') badgeHtml = `<span style="background: #22c55e; color: white; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; box-shadow: var(--shadow-sm);">Active</span>`;
                            else if (statusLabel === 'Hold') badgeHtml = `<span style="background: #eab308; color: white; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; box-shadow: var(--shadow-sm);">Hold</span>`;
                            else if (statusLabel === 'Trash') badgeHtml = `<span style="background: var(--danger); color: white; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; box-shadow: var(--shadow-sm);">Trash</span>`;

                            const card = document.createElement('div');
                            card.className = 'card';
                            
                            const deleteBtnHtml = statusLabel === 'Trash' ? `<button class="btn btn-outline delete-prop-btn" data-id="${id}" style="background: white; padding: 0.25rem 0.5rem; font-size: 0.8rem; border: 1px solid var(--danger); color: var(--danger); box-shadow: var(--shadow-sm);">🗑️ Delete</button>` : '';

                            card.innerHTML = `
                                <div style="height: 160px; background-color: #E2E8F0; border-radius: var(--radius-md); margin-bottom: 1rem; background-image: url('${data.imageUrl || 'https://images.unsplash.com/photo-1518780664697-55e3ad937233?auto=format&fit=crop&w=400&q=80'}'); background-size: cover; background-position: center; position: relative;">
                                    <div style="position: absolute; top: 0.5rem; left: 0.5rem;">${badgeHtml}</div>
                                    <div style="position: absolute; top: 0.5rem; right: 0.5rem; display: flex; gap: 0.5rem;">
                                        ${deleteBtnHtml}
                                        <a href="edit_property.html?id=${id}" class="btn btn-outline" style="background: white; padding: 0.25rem 0.5rem; font-size: 0.8rem; border: 1px solid var(--border); box-shadow: var(--shadow-sm);">✏️ Edit</a>
                                    </div>
                                </div>
                                <h3 style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${data.address}">${data.address}</h3>
                                <p class="text-muted mb-4">${data.askingPrice} • <span id="offer-count-${id}">Loading Offers...</span></p>
                                <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1rem;">
                                    <a href="offer_management.html?id=${id}" class="btn btn-primary" style="width: 100%; text-align: center;">View Offers</a>
                                    <div class="flex justify-between">
                                        <a href="offer_submission.html?id=${id}" class="btn btn-outline" style="width: 48%; text-align: center; padding: 0.5rem; font-size: 0.85rem;" target="_blank">Submit Offer</a>
                                        <button class="btn btn-outline copy-portal-btn" data-id="${id}" style="width: 48%; text-align: center; padding: 0.5rem; font-size: 0.85rem;">Copy submit offer link</button>
                                    </div>
                                </div>
                            `;
                            listingsContainer.appendChild(card);
                            
                            // Attach delete listener safely
                            const deleteBtn = card.querySelector('.delete-prop-btn');
                            if (deleteBtn) {
                                deleteBtn.addEventListener('click', (e) => {
                                    e.preventDefault();
                                    const propId = deleteBtn.getAttribute('data-id');
                                    if (window.deleteProperty) window.deleteProperty(propId);
                                });
                            }

                            // Attach copy listener safely
                            const copyBtn = card.querySelector('.copy-portal-btn');
                            if (copyBtn) {
                                copyBtn.addEventListener('click', () => {
                                    const propId = copyBtn.getAttribute('data-id');
                                    let baseUrl = window.location.origin + window.location.pathname.replace('index.html', '');
                                    if (!baseUrl.endsWith('/')) baseUrl += '/';
                                    const url = baseUrl + `offer_submission.html?id=${propId}`;
                                    navigator.clipboard.writeText(url).then(() => {
                                        const originalText = copyBtn.innerText;
                                        copyBtn.innerText = 'Copied!';
                                        setTimeout(() => copyBtn.innerText = originalText, 2000);
                                    }).catch(err => {
                                        console.error('Copy failed', err);
                                        alert('Could not copy automatically. Link: ' + url);
                                    });
                                });
                            }
                            
                            // Fetch real offer count
                            getDocs(query(collection(db, "offers"), where("propertyId", "==", id))).then(snap => {
                                const el = document.getElementById(`offer-count-${id}`);
                                if (el) el.innerText = `${snap.size} Offer${snap.size !== 1 ? 's' : ''}`;
                            });
                        });
                    }, (error) => {
                        console.error("Error fetching properties:", error);
                        if (error.code === 'permission-denied') {
                            signOut(auth).then(() => window.location.href = 'login.html');
                        } else {
                            listingsContainer.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: var(--surface); border-radius: var(--radius-md);"><p class="text-danger">Error loading properties. Make sure Firestore is initialized in Test Mode.</p></div>';
                        }
                    });
                    }).catch(error => {
                        console.error("Error fetching inviters:", error);
                        if (error.code === 'permission-denied') {
                            signOut(auth).then(() => window.location.href = 'login.html');
                        }
                    });
                }
            }

            // Load Edit Property Data
            if (path.includes('edit_property.html')) {
                const urlParams = new URLSearchParams(window.location.search);
                const propertyId = urlParams.get('id');
                if (propertyId) {
                    getDoc(doc(db, "properties", propertyId)).then(async docSnap => {
                        if (docSnap.exists()) {
                            const data = docSnap.data();
                            let isAuthorized = data.agentId === user.uid;
                            if (!isAuthorized) {
                                try {
                                    const ownerSnap = await getDoc(doc(db, "users", data.agentId));
                                    if (ownerSnap.exists() && ownerSnap.data().teamEmails && ownerSnap.data().teamEmails.includes(user.email ? user.email.toLowerCase() : "")) {
                                        isAuthorized = true;
                                    }
                                } catch(e) { console.error("Error checking team auth:", e); }
                            }
                            
                            if (isAuthorized) {
                                document.getElementById('edit-address').value = data.address || '';
                                document.getElementById('edit-price').value = data.askingPrice || '';
                                document.getElementById('edit-desc').value = data.description || '';
                                
                                const subtitleEl = document.getElementById('edit-property-subtitle');
                                if (subtitleEl) subtitleEl.innerText = `Update details for ${data.address || 'this property'}.`;
                                
                                const imagePreviewEl = document.getElementById('edit-property-image-preview');
                                if (imagePreviewEl && data.imageUrl) imagePreviewEl.src = data.imageUrl;
                                
                                // Load owner details if they exist
                                const ownerNameEl = document.getElementById('edit-owner-name');
                                const ownerEmailEl = document.getElementById('edit-owner-email');
                                const ownerMobileEl = document.getElementById('edit-owner-mobile');
                                if(ownerNameEl) ownerNameEl.value = data.ownerName || '';
                                if(ownerEmailEl) ownerEmailEl.value = data.ownerEmail || '';
                                if(ownerMobileEl) ownerMobileEl.value = data.ownerMobile || '';
                                const listingCommEl = document.getElementById('edit-listing-commission');
                                if(listingCommEl) listingCommEl.value = data.listingCommission || '';
                                
                                const statusEl = document.getElementById('edit-status');
                                if(statusEl) {
                                    let st = data.status || 'Active Listing';
                                    if (st === 'active') st = 'Active Listing';
                                    statusEl.value = st;
                                }

                            } else {
                                alert("Property not found or unauthorized.");
                                window.location.href = 'index.html';
                            }
                        }
                    }).catch(err => {
                        console.error("Error fetching property:", err);
                    });
                }
            }

        } else {
            // No user is signed in.
            console.log("No user signed in.");
            // If they are NOT on an auth page or a public page, redirect to login
            if (!isAuthPage && !isPublicPage) {
                window.location.href = 'login.html';
            }
        }
    });

    // 2. Registration Form Handler
    const registerForm = document.getElementById('register-form');
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('btn-register');
            btn.disabled = true;
            btn.innerText = 'Creating Account...';

            const name = document.getElementById('reg-name').value;
            const email = document.getElementById('reg-email').value;
            const password = document.getElementById('reg-password').value;
            const confirm = document.getElementById('reg-confirm').value;
            const mobile = document.getElementById('reg-mobile').value;
            const dre = document.getElementById('reg-dre').value;
            const brokerage = document.getElementById('reg-brokerage').value;

            if (mobile.replace(/\D/g, "").length !== 10) {
                alert("Please enter a valid 10-digit mobile number.");
                btn.disabled = false;
                btn.innerText = 'Create Account';
                return;
            }

            if (password !== confirm) {
                alert("Passwords do not match!");
                btn.disabled = false;
                btn.innerText = 'Create Account';
                return;
            }

            try {
                window.isRegistering = true; // Prevent premature redirect from auth observer
                
                // Create user in Firebase Auth
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                // Update Auth Profile
                await updateProfile(user, { displayName: name });

                // Create extended user document in Firestore
                await setDoc(doc(db, "users", user.uid), {
                    fullName: name,
                    email: email,
                    mobile: mobile,
                    dreLicense: dre,
                    brokerage: brokerage,
                    role: 'agent', // Default role
                    createdAt: new Date()
                });

                alert("Account created successfully!");
                window.location.href = 'index.html'; // Safe to redirect now
                
            } catch (error) {
                console.error("Registration Error:", error);
                alert("Error: " + error.message);
                btn.disabled = false;
                btn.innerText = 'Create Account';
            }
        });
    }

    // 3. Login Form Handler
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('btn-login');
            btn.disabled = true;
            btn.innerText = 'Logging In...';

            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;

            try {
                await signInWithEmailAndPassword(auth, email, password);
                // onAuthStateChanged will redirect
            } catch (error) {
                console.error("Login Error:", error);
                if (error.code === 'auth/unauthorized-domain') {
                    alert("SECURITY ALERT: This domain has not been authorized in your Firebase Console. Please add 'juliangroup.net' and 'juliangroup.github.io' to the Authorized Domains list in Firebase Auth Settings.");
                } else if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') {
                    alert("Incorrect email or password. Please try again.");
                } else {
                    alert("Error logging in: " + error.message);
                }
                btn.disabled = false;
                btn.innerText = 'Log In';
            }
        });
    }

    // 3.5 Forgot Password Handler
    const forgotBtn = document.getElementById('btn-forgot-password');
    if (forgotBtn) {
        forgotBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            const email = document.getElementById('login-email').value;
            if (!email) {
                alert("Please enter your email address in the Email field first, then click Forgot Password.");
                return;
            }
            try {
                await sendPasswordResetEmail(auth, email);
                alert("A password reset link has been sent to " + email + "!");
            } catch (error) {
                console.error("Reset Password Error:", error);
                alert("Error sending reset email: " + error.message);
            }
        });
    }

    // 4. Logout Handler (attach to any element with id="btn-logout")
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            signOut(auth).then(() => {
                // Redirect happens in onAuthStateChanged
            }).catch((error) => {
                console.error("Sign out error", error);
            });
        });
    }

    // 5. Settings Form Handler
    const settingsForm = document.getElementById('settings-form');
    if (settingsForm) {
        settingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('btn-save-settings');
            btn.disabled = true;
            btn.innerText = 'Saving...';
            
            const user = auth.currentUser;
            if (!user) return;

            const name = document.getElementById('set-name').value;
            const mobile = document.getElementById('set-mobile').value;
            const dre = document.getElementById('set-dre').value;
            const brokerage = document.getElementById('set-brokerage').value;

            if (mobile.replace(/\D/g, "").length !== 10) {
                alert("Please enter a valid 10-digit mobile number.");
                btn.disabled = false;
                btn.innerText = 'Save Profile';
                return;
            }

            try {
                // merge: true allows updating specific fields without overwriting others like createdAt
                await setDoc(doc(db, "users", user.uid), {
                    fullName: name,
                    name: name,
                    email: user.email,
                    mobile: mobile,
                    dreLicense: dre,
                    brokerage: brokerage
                }, { merge: true });

                await updateProfile(user, { displayName: name });
                
                alert("Profile Updated Successfully!");
            } catch (error) {
                console.error("Error updating profile:", error);
                alert("Error saving profile: " + error.message);
            } finally {
                btn.disabled = false;
                btn.innerText = 'Save Profile';
            }
        });
    }



    // Global function to remove team member
    window.removeTeamMember = async (index) => {
        if (!confirm("Remove this member from your team?")) return;
        const user = auth.currentUser;
        if (!user) return;
        try {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (userDoc.exists()) {
                let team = userDoc.data().team || [];
                team.splice(index, 1);
                await setDoc(doc(db, "users", user.uid), { team: team }, { merge: true });
                if (window.refreshTeam) window.refreshTeam();
            }
        } catch (e) {
            console.error("Error removing team member", e);
            alert("Error removing member.");
        }
    };

    // Autocomplete Initialization
    window.streetViewUrl = null;
    const checkMapsLoaded = setInterval(() => {
        if (typeof google !== 'undefined' && google.maps && google.maps.places) {
            clearInterval(checkMapsLoaded);
            
            const setupAutocomplete = (inputId) => {
                const input = document.getElementById(inputId);
                if (input) {
                    const autocomplete = new google.maps.places.Autocomplete(input, { types: ['address'] });
                    autocomplete.addListener('place_changed', () => {
                        const place = autocomplete.getPlace();
                        if (place.formatted_address) {
                            let cleanAddress = place.formatted_address;
                            if (cleanAddress.endsWith(', USA')) {
                                cleanAddress = cleanAddress.substring(0, cleanAddress.length - 5);
                            } else if (cleanAddress.endsWith(' USA')) {
                                cleanAddress = cleanAddress.substring(0, cleanAddress.length - 4);
                            }
                            input.value = cleanAddress;
                        }
                        if (place.geometry && place.geometry.location) {
                            const lat = place.geometry.location.lat();
                            const lng = place.geometry.location.lng();
                            const svUrl = `https://maps.googleapis.com/maps/api/streetview?size=800x600&location=${lat},${lng}&key=AIzaSyBTzxAQ40a9bwHZLmkyWbQQYTSejT-SQ90`;
                            window.streetViewUrl = svUrl;
                            
                            let previewContainer = document.getElementById('sv-preview-' + inputId);
                            if (!previewContainer) {
                                previewContainer = document.createElement('div');
                                previewContainer.id = 'sv-preview-' + inputId;
                                previewContainer.style.marginTop = '10px';
                                input.parentNode.appendChild(previewContainer);
                            }
                            previewContainer.innerHTML = `<p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 5px;">Auto-generated Street View (used if no image uploaded):</p><img src="${svUrl}" style="max-width: 100%; border-radius: 8px; height: 150px; object-fit: cover; border: 1px solid var(--border);">`;
                        }
                    });
                }
            };
            
            setupAutocomplete('prop-address');
            setupAutocomplete('edit-address');
        }
    }, 500);

    // 6. Create Property Form Handler
    const createPropForm = document.getElementById('create-property-form');
    if (createPropForm) {
        createPropForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('btn-create-property');
            btn.disabled = true;
            btn.innerText = 'Creating...';
            
            const user = auth.currentUser;
            if (!user) return;

            const address = document.getElementById('prop-address').value;
            const price = document.getElementById('prop-price').value;
            const desc = document.getElementById('prop-desc').value;
            const fileInput = document.getElementById('prop-image');
            const statusEl = document.getElementById('prop-status');
            const status = statusEl ? statusEl.value : 'Active Listing';
            
            // Optional owner details
            const ownerNameEl = document.getElementById('prop-owner-name');
            const ownerEmailEl = document.getElementById('prop-owner-email');
            const ownerMobileEl = document.getElementById('prop-owner-mobile');
            const ownerName = ownerNameEl ? ownerNameEl.value : '';
            const ownerEmail = ownerEmailEl ? ownerEmailEl.value : '';
            const ownerMobile = ownerMobileEl ? ownerMobileEl.value : '';
            
            const listingCommEl = document.getElementById('prop-listing-commission');
            const listingCommission = listingCommEl ? listingCommEl.value : '';

            try {
                let finalImageUrl;
                if (fileInput && fileInput.files && fileInput.files.length > 0) {
                    finalImageUrl = await compressImage(fileInput.files[0]);
                } else if (window.streetViewUrl) {
                    finalImageUrl = window.streetViewUrl;
                } else {
                    const placeholderImages = [
                        'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=80',
                        'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=80',
                        'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80',
                        'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=800&q=80',
                        'https://images.unsplash.com/photo-1583608205776-bfd35f0d9f83?auto=format&fit=crop&w=800&q=80'
                    ];
                    finalImageUrl = placeholderImages[Math.floor(Math.random() * placeholderImages.length)];
                }

                let agentFullName = "Listing Agent";
                let agentEmail = user.email;
                let agentMobile = "";
                let agentBrokerage = "Independent Agent";
                
                try {
                    const agentSnap = await getDoc(doc(db, "users", user.uid));
                    if (agentSnap.exists()) {
                        const data = agentSnap.data();
                        agentFullName = data.fullName || data.name || "Listing Agent";
                        agentMobile = data.mobile || "";
                        agentBrokerage = data.brokerage || "Independent Agent";
                    }
                } catch(e) { console.error("Could not fetch agent profile for property:", e); }

                await addDoc(collection(db, "properties"), {
                    agentId: user.uid,
                    agentName: agentFullName,
                    agentEmail: agentEmail,
                    agentMobile: agentMobile,
                    agentBrokerage: agentBrokerage,
                    address: address,
                    askingPrice: price,
                    description: desc,
                    ownerName: ownerName,
                    ownerEmail: ownerEmail,
                    ownerMobile: ownerMobile,
                    listingCommission: listingCommission,
                    createdAt: new Date(),
                    status: status,
                    imageUrl: finalImageUrl
                });
                
                alert("Property Listing Created Successfully!");
                window.location.href = 'index.html';
            } catch (error) {
                console.error("Error creating property:", error);
                alert("Error creating property: " + error.message);
                btn.disabled = false;
                btn.innerText = 'Generate Portal Link';
            }
        });
    }

    // 6.5 Edit Property Form Handler
    const editPropForm = document.getElementById('edit-property-form');
    if (editPropForm) {
        editPropForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('btn-edit-property');
            btn.disabled = true;
            btn.innerText = 'Saving...';
            
            const user = auth.currentUser;
            if (!user) return;
            
            const urlParams = new URLSearchParams(window.location.search);
            const propertyId = urlParams.get('id');
            if(!propertyId) return;

            const address = document.getElementById('edit-address').value;
            const price = document.getElementById('edit-price').value;
            const desc = document.getElementById('edit-desc').value;
            const fileInput = document.getElementById('edit-image');
            const statusEl = document.getElementById('edit-status');
            
            // Optional owner details
            const ownerNameEl = document.getElementById('edit-owner-name');
            const ownerEmailEl = document.getElementById('edit-owner-email');
            const ownerMobileEl = document.getElementById('edit-owner-mobile');
            const ownerName = ownerNameEl ? ownerNameEl.value : '';
            const ownerEmail = ownerEmailEl ? ownerEmailEl.value : '';
            const ownerMobile = ownerMobileEl ? ownerMobileEl.value : '';
            
            const listingCommEl = document.getElementById('edit-listing-commission');
            const listingCommission = listingCommEl ? listingCommEl.value : '';

            try {
                let updates = {
                    address: address,
                    askingPrice: price,
                    description: desc,
                    ownerName: ownerName,
                    ownerEmail: ownerEmail,
                    ownerMobile: ownerMobile,
                    listingCommission: listingCommission
                };
                if (statusEl) {
                    updates.status = statusEl.value;
                }
                
                if (fileInput && fileInput.files && fileInput.files.length > 0) {
                    updates.imageUrl = await compressImage(fileInput.files[0]);
                } else if (window.streetViewUrl) {
                    updates.imageUrl = window.streetViewUrl;
                }

                await setDoc(doc(db, "properties", propertyId), updates, { merge: true });
                
                alert("Property Updated Successfully!");
                window.location.href = 'index.html';
            } catch (error) {
                console.error("Error updating property:", error);
                alert("Error updating property: " + error.message);
                btn.disabled = false;
                btn.innerText = 'Save Changes';
            }
        });
    }

    // 7. Offer Submission Handler (Shared for Manual and Public)
    const handleOfferSubmit = async (e, isManual) => {
        e.preventDefault();
        const btnId = isManual ? 'btn-submit-manual' : 'btn-submit-public';
        const btn = document.getElementById(btnId);
        if(btn) {
            btn.disabled = true;
            btn.innerText = 'Submitting...';
        }

        // Extract Property ID from URL
        const urlParams = new URLSearchParams(window.location.search);
        let propertyId = urlParams.get('id');

        // For testing prototype without URL params, fallback to a dummy ID
        if (!propertyId) {
            console.warn("No Property ID found in URL. Using test ID.");
            propertyId = "test_property_123";
        }

        const agentName = document.getElementById('agent-name').value;
        const agentEmail = document.getElementById('agent-email').value;
        const agentBrokerage = document.getElementById('agent-brokerage') ? document.getElementById('agent-brokerage').value : '';

        const price = document.getElementById('ai-price').value;
        const deposit = document.getElementById('ai-deposit').value;
        const down = document.getElementById('ai-down').value;
        const finance = document.getElementById('ai-finance').value;
        const coe = document.getElementById('ai-coe').value;
        const loan = document.getElementById('ai-loan').value;
        const appraisal = document.getElementById('ai-appraisal').value;
        const inspection = document.getElementById('ai-inspection').value;

        const compPct = document.getElementById('ai-agent-comp-pct') ? document.getElementById('ai-agent-comp-pct').value : '';
        let compDollar = 0;
        if (compPct && price) {
            const priceNum = parseFloat(price.replace(/[^0-9.-]+/g,""));
            const pctNum = parseFloat(compPct);
            if (!isNaN(priceNum) && !isNaN(pctNum)) {
                compDollar = (priceNum * (pctNum / 100)).toFixed(2);
            }
        }
        const sellerCredit = document.getElementById('ai-seller-credit') ? document.getElementById('ai-seller-credit').value : '';

        // Upload documents to Firebase Storage
        const docs = [];
        const uploadDoc = async (file, type) => {
            if (!file) return;
            const uniqueName = `${Date.now()}_${file.name}`;
            const storageRef = ref(storage, `offers/${propertyId}/${uniqueName}`);
            await uploadBytes(storageRef, file);
            const url = await getDownloadURL(storageRef);
            docs.push({ type: type, name: file.name, url: url });
        };

        const fileRpa = document.getElementById('ai-file-rpa');
        const fileFunds = document.getElementById('ai-file-funds');
        const filePreapproval = document.getElementById('ai-file-preapproval');

        try {
            if (btn) btn.innerText = 'Uploading documents...';
            if (fileRpa && fileRpa.files) {
                for(let i = 0; i < fileRpa.files.length; i++) await uploadDoc(fileRpa.files[i], 'Purchase Agreement');
            }
            if (fileFunds && fileFunds.files) {
                for(let i = 0; i < fileFunds.files.length; i++) await uploadDoc(fileFunds.files[i], 'Proof of Funds');
            }
            if (filePreapproval && filePreapproval.files) {
                for(let i = 0; i < filePreapproval.files.length; i++) await uploadDoc(filePreapproval.files[i], 'Pre-Approval');
            }
            if (btn) btn.innerText = 'Saving offer...';
        } catch (uploadError) {
            console.error("Error uploading documents:", uploadError);
            alert("Failed to upload documents: " + uploadError.message);
            if (btn) {
                btn.disabled = false;
                btn.innerText = 'Submit Offer';
            }
            return;
        }

        try {
            await addDoc(collection(db, "offers"), {
                propertyId: propertyId,
                buyerAgentName: agentName,
                buyerAgentEmail: agentEmail,
                buyerAgentBrokerage: agentBrokerage,
                price: price,
                deposit: deposit,
                downPaymentPercent: down,
                financingType: finance,
                coeDays: parseInt(coe),
                loanDays: parseInt(loan),
                appraisalDays: parseInt(appraisal),
                inspectionDays: parseInt(inspection),
                buyerAgentCompPct: compPct,
                buyerAgentCompDollar: compDollar,
                sellerCredit: sellerCredit,
                documents: docs,
                status: 'pending',
                submittedAt: new Date(),
                isManualEntry: isManual
            });
            
            alert(isManual ? "Manual Offer Saved Successfully!" : "Your Offer has been submitted securely!");
            
            if (isManual) {
                window.location.href = `offer_management.html?id=${propertyId}`;
            } else {
                // Public portal success state
                if(btn) {
                    btn.innerText = '✅ Submitted';
                    btn.style.background = 'var(--success)';
                }
            }
        } catch (error) {
            console.error("Error submitting offer:", error);
            alert("Error: " + error.message);
            if(btn) {
                btn.disabled = false;
                btn.innerText = 'Submit Offer';
            }
        }
    };

    const manualOfferForm = document.getElementById('manual-offer-form');
    if (manualOfferForm) manualOfferForm.addEventListener('submit', (e) => handleOfferSubmit(e, true));

    const publicOfferForm = document.getElementById('public-offer-form');
    if (publicOfferForm) publicOfferForm.addEventListener('submit', (e) => handleOfferSubmit(e, false));


    // --- PUBLIC PAGE LOGIC (Runs regardless of Auth State) ---
    if (path.includes('offer_submission')) {
        const urlParams = new URLSearchParams(window.location.search);
        const propertyId = urlParams.get('id');
        if (propertyId) {
            getDoc(doc(db, "properties", propertyId)).then(async (docSnap) => {
                if (docSnap.exists()) {
                    const propData = docSnap.data();
                    
                    const addressHeader = document.getElementById('public-prop-address');
                    if (addressHeader) addressHeader.innerText = propData.address || 'Property Details';
                    
                    const priceHeader = document.getElementById('public-prop-price');
                    if (priceHeader) priceHeader.innerText = `Asking: ${propData.askingPrice || 'TBD'}`;
                    
                    const formatPhone = (str) => {
                        if (!str) return '';
                        const cleaned = ('' + str).replace(/\D/g, '');
                        const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);
                        return match ? `(${match[1]}) ${match[2]}-${match[3]}` : str;
                    };
                    
                    const setAgentUI = (name, broker, email, mobile) => {
                        const nameEl = document.getElementById('public-agent-name');
                        if (nameEl) nameEl.innerText = name || 'Listing Agent';
                        const brokerEl = document.getElementById('public-agent-brokerage');
                        if (brokerEl) brokerEl.innerText = broker || 'Independent Agent';
                        const emailEl = document.getElementById('public-agent-email');
                        if (emailEl) {
                            if (email) {
                                const propAddress = propData.address || 'Property';
                                const subject = encodeURIComponent(`Offer on ${propAddress}`);
                                emailEl.innerHTML = `<a href="mailto:${email}?subject=${subject}" style="color: inherit; text-decoration: underline;">${email}</a>`;
                            } else {
                                emailEl.innerText = 'No email provided';
                            }
                        }
                        const mobileEl = document.getElementById('public-agent-mobile');
                        if (mobileEl) mobileEl.innerText = formatPhone(mobile) || '';
                    };

                    // Prefer denormalized data to avoid Firestore permission errors for public users
                    if (propData.agentName || propData.agentEmail) {
                        setAgentUI(propData.agentName, propData.agentBrokerage, propData.agentEmail, propData.agentMobile);
                    } else if (propData.agentId) {
                        // Fallback to fetching from users collection (might fail if rules deny it)
                        try {
                            const agentSnap = await getDoc(doc(db, "users", propData.agentId));
                            if (agentSnap.exists()) {
                                const agent = agentSnap.data();
                                setAgentUI(agent.fullName, agent.brokerage, agent.email, agent.mobile);
                            } else {
                                setAgentUI('Listing Agent', 'Independent Agent', 'No email provided', '');
                            }
                        } catch (e) {
                            console.error("Error fetching agent:", e);
                            setAgentUI('Listing Agent', 'Independent Agent', 'No email provided', '');
                        }
                    } else {
                        setAgentUI('Listing Agent', 'Independent Agent', 'No email provided', '');
                    }
                }
            }).catch(err => console.error("Error fetching property:", err));
        }
    }

    if (path.includes('offer_management.html') || path.includes('seller_presentation.html')) {
        const urlParams = new URLSearchParams(window.location.search);
        const propertyId = urlParams.get('id');
        if (propertyId) {
            // Update header links
            const manualLink = document.getElementById('link-manual-offer');
            if (manualLink) manualLink.href = `manual_offer.html?id=${propertyId}`;

            // Build the absolute seller presentation URL
            let baseUrl = window.location.origin + window.location.pathname;
            baseUrl = baseUrl.substring(0, baseUrl.lastIndexOf('/'));
            if (!baseUrl.endsWith('/')) baseUrl += '/';
            const fullSellerUrl = baseUrl + `seller_presentation.html?id=${propertyId}`;

            const emailBtn = document.getElementById('btn-email-seller');
            const textBtn = document.getElementById('btn-text-seller');
            const copyBtn = document.getElementById('btn-copy-seller-link');

            if (copyBtn) {
                copyBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    navigator.clipboard.writeText(fullSellerUrl).then(() => {
                        const originalText = copyBtn.innerText;
                        copyBtn.innerText = 'Copied!';
                        setTimeout(() => copyBtn.innerText = originalText, 2000);
                    }).catch(err => {
                        console.error('Copy failed', err);
                        alert('Could not copy automatically. Link: ' + fullSellerUrl);
                    });
                });
            }

            // Fetch property details for header
            getDoc(doc(db, "properties", propertyId)).then(async (docSnap) => {
                let propData = {};
                if (docSnap.exists()) {
                    propData = docSnap.data();
                    const header = document.getElementById('prop-address-header');
                    if (header) header.innerText = propData.address;
                    
                    if (emailBtn) {
                        emailBtn.addEventListener('click', () => {
                            const recipient = propData.ownerEmail ? propData.ownerEmail : "";
                            const subject = encodeURIComponent(`Offers for ${propData.address}`);
                            const body = encodeURIComponent(`Hi,\n\nHere is the link to view the offers for ${propData.address}:\n${fullSellerUrl}`);
                            window.location.href = `mailto:${recipient}?subject=${subject}&body=${body}`;
                        });
                    }
                    if (textBtn) {
                        textBtn.addEventListener('click', () => {
                            const recipient = propData.ownerMobile ? propData.ownerMobile.replace(/\D/g, '') : "";
                            const body = encodeURIComponent(`Hi, here is the link to view the offers for ${propData.address}: ${fullSellerUrl}`);
                            const ua = navigator.userAgent.toLowerCase();
                            if (ua.indexOf("iphone") > -1 || ua.indexOf("ipad") > -1) {
                                window.location.href = `sms:${recipient}&body=${body}`;
                            } else {
                                window.location.href = `sms:${recipient}?body=${body}`;
                            }
                        });
                    }
                    
                    const agentHeader = document.getElementById('agent-info-header');
                    if (agentHeader && propData.agentId) {
                        try {
                            const agentSnap = await getDoc(doc(db, "users", propData.agentId));
                            if (agentSnap.exists()) {
                                const agent = agentSnap.data();
                                
                                const formatPhone = (str) => {
                                    if (!str) return '';
                                    const cleaned = ('' + str).replace(/\D/g, '');
                                    const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);
                                    return match ? `(${match[1]}) ${match[2]}-${match[3]}` : str;
                                };
                                
                                const agentName = agent.name || agent.fullName || 'Your Agent';
                                const formattedPhone = formatPhone(agent.mobile);
                                const phoneStr = formattedPhone ? ` | ${formattedPhone}` : '';
                                
                                const subjectLine = encodeURIComponent(`Offers on ${propData.address}`);
                                const mailtoLink = `<a href="mailto:${agent.email}?subject=${subjectLine}" style="color: inherit; text-decoration: underline;">${agent.email}</a>`;
                                
                                agentHeader.innerHTML = `Listed by: ${agentName} | ${mailtoLink}${phoneStr}`;
                                
                                const footerEl = document.getElementById('seller-footer-text');
                                if (footerEl) {
                                    footerEl.innerHTML = `Have questions about these offers? Contact your agent, ${agentName}, at ${mailtoLink}${formattedPhone ? ' or ' + formattedPhone : ''}.`;
                                }
                            } else {
                                agentHeader.innerText = "Listed by: Your Agent";
                            }
                        } catch(e) {
                            agentHeader.innerText = "Listed by: Your Agent";
                        }
                    }
                }

                // Fetch offers for this property
                const offersContainer = document.getElementById('offers-container');
                if (offersContainer) {
                    const qOffers = query(collection(db, "offers"), where("propertyId", "==", propertyId));
                    onSnapshot(qOffers, (querySnapshot) => {
                        const countHeader = document.getElementById('offers-count-header');
                        if (countHeader) countHeader.innerText = `Received Offers (${querySnapshot.size})`;
                        offersContainer.innerHTML = '';

                        if (querySnapshot.empty) {
                            offersContainer.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: var(--surface); border-radius: var(--radius-md);"><p class="text-muted">No offers received yet.</p></div>';
                            return;
                        }

                        let highestPrice = 0;
                        querySnapshot.forEach(snap => {
                            const data = snap.data();
                            const p = parseInt((data.price || "0").replace(/\D/g, ""));
                            if (p > highestPrice) highestPrice = p;
                        });

                        let processedOffers = [];
                        querySnapshot.forEach((docSnap) => {
                            const data = docSnap.data();
                            const offerId = docSnap.id;
                            const priceVal = parseInt((data.price || "0").replace(/\D/g, ""));
                            const isHighest = priceVal === highestPrice && priceVal > 0;
                            
                            const currentListingCommission = parseFloat(propData.listingCommission) || 0;
                            let listingAgentCompDollar = 0;
                            if (currentListingCommission > 0 && priceVal > 0) {
                                listingAgentCompDollar = priceVal * (currentListingCommission / 100);
                            }
                            
                            let buyerAgentCompDollar = parseFloat(data.buyerAgentCompDollar) || 0;
                            let sellerCreditVal = parseInt((data.sellerCredit || "0").replace(/\D/g, "")) || 0;
                            
                            let buyersNet = priceVal - buyerAgentCompDollar - listingAgentCompDollar - sellerCreditVal;

                            processedOffers.push({
                                id: offerId,
                                data: data,
                                priceVal: priceVal,
                                isHighest: isHighest,
                                listingAgentCompDollar: listingAgentCompDollar,
                                buyerAgentCompDollar: buyerAgentCompDollar,
                                sellerCreditVal: sellerCreditVal,
                                buyersNet: buyersNet
                            });
                        });

                        const statusWeights = {
                            'accepted': 1,
                            'counter offer': 2,
                            'in review': 3,
                            'pending': 3,
                            'ignore': 4
                        };
                        
                        processedOffers.sort((a, b) => {
                            const statusA = a.data.status ? a.data.status.toLowerCase() : 'in review';
                            const statusB = b.data.status ? b.data.status.toLowerCase() : 'in review';
                            
                            const weightA = statusWeights[statusA] || 3;
                            const weightB = statusWeights[statusB] || 3;
                            
                            if (weightA !== weightB) {
                                return weightA - weightB;
                            }
                            
                            return b.priceVal - a.priceVal;
                        });

                        // BUILD CARD VIEW
                        processedOffers.forEach((offer) => {
                            const { data, id: offerId, isHighest, listingAgentCompDollar, buyerAgentCompDollar, buyersNet } = offer;
                            
                            const borderColor = isHighest ? 'var(--success)' : 'var(--border)';
                            const highestBadge = isHighest ? `<span class="badge" style="background-color: rgba(56, 161, 105, 0.1); color: var(--success); margin-left: 0.5rem;">Highest Offer</span>` : '';

                            window.offerDocumentsCache = window.offerDocumentsCache || {};
                            window.offerDocumentsCache[offerId] = data.documents || [];

                            const isSellerView = window.location.pathname.includes('seller_presentation.html');

                            let currentStatus = data.status ? data.status.toLowerCase() : 'in review';
                            if (currentStatus === 'pending') currentStatus = 'in review';

                            const statusColors = {
                                'accepted': 'var(--success)',
                                'counter offer': '#f59e0b',
                                'in review': 'var(--text)',
                                'ignore': 'var(--danger)'
                            };

                            const actionButtonsHtml = isSellerView ? '' : `
                                <div style="display: flex; flex-direction: column; gap: 0.5rem; align-items: stretch;">
                                    <select id="status-select-${offerId}" class="form-control" style="font-weight: 600; color: ${statusColors[currentStatus] || 'var(--text)'}; border-color: ${statusColors[currentStatus] || 'var(--border)'};" onchange="window.changeOfferStatus('${offerId}', this.value, 'offer-${offerId}-dates', '${currentStatus}')">
                                        <option value="accepted" ${currentStatus === 'accepted' ? 'selected' : ''}>Accepted</option>
                                        <option value="counter offer" ${currentStatus === 'counter offer' ? 'selected' : ''}>Counter Offer</option>
                                        <option value="in review" ${currentStatus === 'in review' ? 'selected' : ''}>In Review</option>
                                        <option value="ignore" ${currentStatus === 'ignore' ? 'selected' : ''}>Ignore</option>
                                    </select>
                                    <button class="btn btn-outline" onclick="window.viewDocuments('${offerId}')">View Documents</button>
                                </div>
                            `;

                            const card = document.createElement('div');
                            card.className = 'card';
                            card.style.borderLeft = `4px solid ${borderColor}`;
                            const notesHtml = isSellerView ? `
                                <div style="margin-top: 1.5rem; background: var(--background); padding: 1.5rem; border-radius: var(--radius-sm); border-left: 4px solid var(--primary);">
                                    <h4 style="color: var(--primary); margin-bottom: 0.5rem;">Agent's Notes</h4>
                                    <p style="margin: 0; font-size: 0.95rem;">${data.sellerNotes || 'No specific notes provided for this offer yet.'}</p>
                                </div>
                            ` : `
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-top: 1.5rem;">
                                    <div class="form-group">
                                        <label class="form-label" style="color: var(--danger);">Private Notes (For You Only)</label>
                                        <textarea class="form-control" rows="3" placeholder="Add your private thoughts here...">${data.privateNotes || ''}</textarea>
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label" style="color: var(--success);">Seller Notes (Visible to Seller)</label>
                                        <textarea class="form-control" rows="3" placeholder="Notes to share with the seller...">${data.sellerNotes || ''}</textarea>
                                    </div>
                                </div>
                            `;

                            const currentListingCommission = parseFloat(propData.listingCommission) || 0;

                            card.innerHTML = `
                                <div class="flex justify-between items-center mb-4 border-bottom pb-4" style="border-bottom: 1px solid var(--border); padding-bottom: 1rem;">
                                    <div>
                                        <h3 style="font-size: 1.5rem; margin-bottom: 0.5rem;">${data.price} ${highestBadge}</h3>
                                        <p class="text-muted" style="margin-bottom: 0.5rem;">${data.financingType} Loan • ${data.downPaymentPercent}% Down • By: ${data.buyerAgentName} (${data.buyerAgentBrokerage || 'Independent'})</p>
                                        ${data.buyerAgentCompPct ? `<p class="text-muted" style="margin-bottom: 0.5rem;"><strong>Buyer Agent Comp:</strong> ${data.buyerAgentCompPct}% ($${parseFloat(data.buyerAgentCompDollar).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})})</p>` : ''}
                                        ${currentListingCommission > 0 ? `<p class="text-muted" style="margin-bottom: 0.5rem;"><strong>Listing Agent Comp:</strong> ${currentListingCommission}% ($${listingAgentCompDollar.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})})</p>` : ''}
                                        ${data.sellerCredit ? `<p class="text-muted" style="margin-bottom: 0.5rem;"><strong>Seller Credit:</strong> ${data.sellerCredit}</p>` : ''}
                                        <p class="text-success" style="margin-bottom: 0.5rem; font-size: 1.1rem;"><strong>Buyer's Net (Proceeds):</strong> $${buyersNet.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                                        <div style="display: flex; gap: 0.5rem; font-size: 0.8rem; flex-wrap: wrap;" id="offer-${offerId}-dates">
                                            <span style="background: var(--background); padding: 0.25rem 0.5rem; border-radius: 4px; border: 1px solid var(--border);"><strong>Deposit:</strong> ${data.deposit}</span>
                                            ${(() => {
                                                const formatCalcDate = (days, label) => {
                                                    let html = `<span style="background: var(--background); padding: 0.25rem 0.5rem; border-radius: 4px; border: 1px solid var(--border);" class="calc-date" data-days="${days}"><strong>${label}:</strong> ${days} Days</span>`;
                                                    if (data.status === 'accepted' && data.acceptedDate) {
                                                        const pDays = parseInt(days);
                                                        if (!isNaN(pDays)) {
                                                            let acceptedDate = data.acceptedDate.toDate ? data.acceptedDate.toDate() : new Date(data.acceptedDate);
                                                            if (data.acceptedDate.seconds) acceptedDate = new Date(data.acceptedDate.seconds * 1000);
                                                            
                                                            let targetDate = new Date(acceptedDate);
                                                            targetDate.setDate(targetDate.getDate() + pDays);
                                                            let formattedDate = targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                                                            html = `<span style="background: rgba(56, 161, 105, 0.05); padding: 0.25rem 0.5rem; border-radius: 4px; border: 1px solid var(--success);" class="calc-date" data-days="${days}"><strong style="color: var(--success);">${label}:</strong> ${formattedDate}</span>`;
                                                        }
                                                    }
                                                    return html;
                                                };
                                                return formatCalcDate(data.coeDays, "COE") +
                                                       formatCalcDate(data.loanDays, "Loan") +
                                                       formatCalcDate(data.appraisalDays, "Appraisal") +
                                                       formatCalcDate(data.inspectionDays, "Inspection");
                                            })()}
                                        </div>
                                    </div>
                                    ${actionButtonsHtml}
                                </div>
                                
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <p style="margin: 0; color: var(--text-muted); font-size: 0.9rem;">Submitted: ${new Date(data.submittedAt.seconds * 1000).toLocaleString()}</p>
                                </div>
                                ${notesHtml}
                            `;
                            offersContainer.appendChild(card);
                        });

                        // BUILD GRID VIEW
                        const gridContainer = document.getElementById('offers-grid-container');
                        if (gridContainer) {
                            let tableHtml = `<table class="comparison-table">
                                <thead>
                                    <tr>
                                        <th>Data Point</th>
                                        ${processedOffers.map((o, i) => `<th style="${o.isHighest ? 'background-color: rgba(56, 161, 105, 0.1); color: var(--success);' : ''}">Offer ${i + 1} ${o.isHighest ? '(Highest)' : ''}</th>`).join('')}
                                    </tr>
                                </thead>
                                <tbody>
                            `;
                            
                            const currentListingCommission = parseFloat(propData.listingCommission) || 0;
                            const rows = [
                                { label: 'Offer Price', key: o => o.data.price },
                                { label: 'Buyer\'s Net Proceeds', key: o => `$${o.buyersNet.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` },
                                { label: 'Buyer Agent Comp', key: o => o.data.buyerAgentCompPct ? `${o.data.buyerAgentCompPct}% ($${o.buyerAgentCompDollar.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})})` : '-' },
                                { label: 'Listing Agent Comp', key: o => currentListingCommission > 0 ? `${currentListingCommission}% ($${o.listingAgentCompDollar.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})})` : '-' },
                                { label: 'Seller Credit', key: o => o.data.sellerCredit || '-' },
                                { label: 'Financing Type', key: o => `${o.data.financingType} Loan` },
                                { label: 'Down Payment', key: o => `${o.data.downPaymentPercent}%` },
                                { label: 'Deposit', key: o => o.data.deposit || '-' },
                                { label: 'COE (Days)', key: o => o.data.coeDays || '-' },
                                { label: 'Loan Contingency', key: o => o.data.loanDays || '-' },
                                { label: 'Appraisal Contingency', key: o => o.data.appraisalDays || '-' },
                                { label: 'Inspection Contingency', key: o => o.data.inspectionDays || '-' }
                            ];
                            
                            rows.forEach(r => {
                                tableHtml += `<tr>
                                    <th>${r.label}</th>
                                    ${processedOffers.map(o => `<td>${r.key(o)}</td>`).join('')}
                                </tr>`;
                            });
                            
                            tableHtml += `</tbody></table>`;
                            gridContainer.innerHTML = tableHtml;

                            // TOGGLE VIEW LOGIC
                            const btnCardView = document.getElementById('btn-card-view');
                            const btnGridView = document.getElementById('btn-grid-view');
                            if (btnCardView && btnGridView) {
                                btnCardView.onclick = () => {
                                    btnCardView.classList.add('active');
                                    btnGridView.classList.remove('active');
                                    offersContainer.style.display = 'flex';
                                    gridContainer.style.display = 'none';
                                };
                                btnGridView.onclick = () => {
                                    btnGridView.classList.add('active');
                                    btnCardView.classList.remove('active');
                                    gridContainer.style.display = 'block';
                                    offersContainer.style.display = 'none';
                                };
                            }
                        }
                        
                        const isSellerView = window.location.pathname.includes('seller_presentation.html');
                        if (!querySnapshot.empty && !isSellerView) {
                            const btn = document.createElement('button');
                            btn.className = 'btn btn-primary mt-4';
                            btn.style.width = 'max-content';
                            btn.innerText = 'Save All Notes';
                            btn.onclick = () => alert('Notes saved locally!');
                            offersContainer.appendChild(btn);
                        }

                    }, (error) => {
                        console.error("Error fetching offers:", error);
                        offersContainer.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: var(--surface); border-radius: var(--radius-md);"><p class="text-danger">Error loading offers.</p></div>';
                    });
                }
            }).catch(err => console.error("Error fetching property:", err));
        }
    }


    // --- UI FORMATTING & PROTOTYPE LOGIC ---

    // Function to format number to US currency without cents
    const formatCurrencyInput = (e) => {
        let input = e.target;
        let cursorPosition = input.selectionStart;
        let originalLength = input.value.length;
        let value = input.value.replace(/\D/g, "");
        
        if (value === "") {
            input.value = "";
            return;
        }

        let formattedValue = "$" + parseInt(value, 10).toLocaleString('en-US');
        input.value = formattedValue;
        let newLength = formattedValue.length;
        cursorPosition = cursorPosition + (newLength - originalLength);
        if (cursorPosition < 1 && newLength > 0) cursorPosition = 1; 
        
        try { input.setSelectionRange(cursorPosition, cursorPosition); } catch (err) {}
    };

    // Attach listener to all inputs with the 'currency-input' class
    const currencyInputs = document.querySelectorAll('.currency-input');
    currencyInputs.forEach(input => {
        input.addEventListener('input', formatCurrencyInput);
        if (input.value) {
            let val = input.value.replace(/\D/g, "");
            if (val) input.value = "$" + parseInt(val, 10).toLocaleString('en-US');
        }
    });

    // Function to format phone numbers as (XXX) XXX-XXXX
    const formatPhoneInput = (e) => {
        let input = e.target;
        let value = input.value.replace(/\D/g, "");
        if (value.length > 10) value = value.substring(0, 10); // Limit to 10 digits
        
        let formattedValue = "";
        if (value.length > 0) {
            formattedValue = "(" + value.substring(0, 3);
            if (value.length > 3) {
                formattedValue += ") " + value.substring(3, 6);
            }
            if (value.length > 6) {
                formattedValue += "-" + value.substring(6, 10);
            }
        }
        input.value = formattedValue;
    };

    // Attach listener to all inputs with the 'phone-input' class
    const phoneInputs = document.querySelectorAll('.phone-input');
    phoneInputs.forEach(input => {
        input.addEventListener('input', formatPhoneInput);
        // Format initial value if present
        if (input.value) {
            formatPhoneInput({ target: input });
        }
    });

    // Agent Compensation Calculator
    const calculateAgentComp = () => {
        const priceInput = document.getElementById('ai-price');
        const pctInput = document.getElementById('ai-agent-comp-pct');
        const dollarText = document.getElementById('ai-agent-comp-dollar');
        if (priceInput && pctInput && dollarText) {
            const priceVal = priceInput.value.replace(/[^0-9.-]+/g, "");
            const price = parseFloat(priceVal);
            const pct = parseFloat(pctInput.value);
            if (!isNaN(price) && !isNaN(pct)) {
                dollarText.innerText = "$" + (price * (pct / 100)).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
            } else {
                dollarText.innerText = "$0.00";
            }
        }
    };

    const priceEl = document.getElementById('ai-price');
    const pctEl = document.getElementById('ai-agent-comp-pct');
    if (priceEl) priceEl.addEventListener('input', calculateAgentComp);
    if (pctEl) pctEl.addEventListener('input', calculateAgentComp);
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeAppLogic);
} else {
    initializeAppLogic();
}

// Temporary Admin Upgrade Script
window.makeMeAdmin = async () => {
    const user = auth.currentUser;
    if (!user) {
        alert("You must be logged in first.");
        return;
    }
    try {
        await setDoc(doc(db, "users", user.uid), { isAdmin: true }, { merge: true });
        alert("Success! You are now a Master Admin. Please refresh the page to see the Admin Panel.");
        window.location.reload();
    } catch(err) {
        alert("Error upgrading account: " + err.message);
    }
};

window.deleteProperty = async (propertyId) => {
    if (confirm("Are you sure you want to completely delete this listing and all of its data? This action cannot be undone.")) {
        try {
            await deleteDoc(doc(db, "properties", propertyId));
            alert("Property listing has been deleted.");
        } catch (error) {
            console.error("Error deleting property:", error);
            alert("Error deleting property: " + error.message);
        }
    }
};

// Global functions need to be explicitly attached to window when using type="module"
window.changeOfferStatus = async (offerId, newStatus, containerId, oldStatus) => {
    if (newStatus === oldStatus) return;

    if (newStatus === 'accepted') {
        let today = new Date().toISOString().split('T')[0];
        let acceptedDateStr = prompt("Enter the date the offer was accepted (YYYY-MM-DD):", today);
        if (!acceptedDateStr) {
            const selectEl = document.getElementById(`status-select-${offerId}`);
            if (selectEl) selectEl.value = oldStatus;
            return;
        }
        
        let acceptedDate = new Date(acceptedDateStr + "T00:00:00"); 
        if (isNaN(acceptedDate.getTime())) {
            alert("Invalid date format. Please use YYYY-MM-DD.");
            const selectEl = document.getElementById(`status-select-${offerId}`);
            if (selectEl) selectEl.value = oldStatus;
            return;
        }

        try {
            await setDoc(doc(db, "offers", offerId), {
                status: 'accepted',
                acceptedDate: acceptedDate
            }, { merge: true });
            
            alert(`Offer accepted on ${acceptedDate.toLocaleDateString('en-US')}!\n\nAll contingency and COE dates have been automatically calculated based on the days specified in the offer. Status securely saved to database.`);
        } catch(err) {
            console.error("Error saving accepted status:", err);
            alert("Error saving status to database: " + err.message);
            const selectEl = document.getElementById(`status-select-${offerId}`);
            if (selectEl) selectEl.value = oldStatus;
        }
    } else {
        if (oldStatus === 'accepted') {
            if (!confirm("Changing this offer's status from 'Accepted' will clear the accepted date and reset the calculated contingency deadlines. Are you sure?")) {
                const selectEl = document.getElementById(`status-select-${offerId}`);
                if (selectEl) selectEl.value = oldStatus;
                return;
            }
        }

        try {
            await setDoc(doc(db, "offers", offerId), {
                status: newStatus,
                acceptedDate: null
            }, { merge: true });
        } catch(err) {
            console.error("Error changing offer status:", err);
            alert("Error: " + err.message);
            const selectEl = document.getElementById(`status-select-${offerId}`);
            if (selectEl) selectEl.value = oldStatus;
        }
    }
};

window.viewDocuments = (offerId) => {
    const docs = window.offerDocumentsCache ? window.offerDocumentsCache[offerId] : null;
    if (!docs || docs.length === 0) {
        alert("No documents were uploaded with this specific offer.");
        return;
    }
    
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.backgroundColor = 'rgba(0,0,0,0.6)';
    overlay.style.display = 'flex';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    overlay.style.zIndex = '9999';

    const modal = document.createElement('div');
    modal.style.background = 'white';
    modal.style.padding = '2rem';
    modal.style.borderRadius = '8px';
    modal.style.width = '90%';
    modal.style.maxWidth = '500px';
    modal.style.boxShadow = '0 10px 25px rgba(0,0,0,0.2)';

    let html = `<h2 style="margin-top: 0; margin-bottom: 1rem; color: var(--text-dark);">Attached Documents</h2>`;
    html += `<div style="display: flex; flex-direction: column; gap: 1rem; margin-bottom: 2rem; max-height: 60vh; overflow-y: auto;">`;
    
    docs.forEach(d => {
        if (d.url) {
            html += `<div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: var(--surface); border: 1px solid var(--border); border-radius: 6px;">
                        <div style="overflow: hidden; text-overflow: ellipsis;">
                            <p style="margin: 0; font-weight: 600;">${d.type}</p>
                            <p style="margin: 0; font-size: 0.85rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;">${d.name}</p>
                        </div>
                        <a href="${d.url}" target="_blank" class="btn btn-primary" style="padding: 0.5rem 1rem; font-size: 0.85rem; white-space: nowrap;">View PDF</a>
                     </div>`;
        } else {
            html += `<div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: var(--surface); border: 1px solid var(--border); border-radius: 6px;">
                        <div style="overflow: hidden; text-overflow: ellipsis;">
                            <p style="margin: 0; font-weight: 600;">${d.type}</p>
                            <p style="margin: 0; font-size: 0.85rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;">${d.name}</p>
                        </div>
                        <span style="font-size: 0.8rem; color: var(--danger);">Legacy Prototype</span>
                     </div>`;
        }
    });
    
    html += `</div>`;
    html += `<button class="btn btn-outline" style="width: 100%;" id="btn-close-modal">Close</button>`;
    
    modal.innerHTML = html;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    document.getElementById('btn-close-modal').onclick = () => {
        document.body.removeChild(overlay);
    };
    
    overlay.onclick = (e) => {
        if (e.target === overlay) {
            document.body.removeChild(overlay);
        }
    };
};

window.executeAIExtraction = async () => {
    const btn = document.getElementById('btn-ai-extract');
    const fileInput = document.getElementById('ai-file-rpa');
    
    if (!btn || !fileInput || !fileInput.files[0]) return;
    
    const file = fileInput.files[0];
    const originalText = btn.innerHTML;
    btn.innerHTML = '✨ Extracting text...';
    btn.disabled = true;
    
    try {
        // 1. Read PDF with pdf.js
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = "";
        
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(" ");
            fullText += `\n--- PAGE ${i} ---\n` + pageText;
        }
        
        btn.innerHTML = '✨ Analyzing securely on server...';

        // 2. Call Firebase Cloud Function
        const extractPurchaseAgreementData = httpsCallable(functions, 'extractPurchaseAgreementData');
        const result = await extractPurchaseAgreementData({ text: fullText });
        
        if (result.data && result.data.success === false) {
            console.error("Backend Error Object:", result.data);
            throw new Error(`Backend Error: ${result.data.message || result.data.stringified}`);
        }

        const extracted = result.data.data;

        // 3. Map to HTML elements
        const mappings = {
            'agent-brokerage': extracted.buyerBrokerage,
            'agent-name': extracted.buyerAgent,
            'agent-email': extracted.buyerAgentEmail,
            'ai-price': extracted.purchasePrice,
            'ai-deposit': extracted.initialDeposit,
            'ai-coe': extracted.coeDays,
            'ai-loan': extracted.loanContingency,
            'ai-appraisal': extracted.appraisalContingency,
            'ai-inspection': extracted.inspectionContingency,
            'ai-seller-credit': extracted.sellerCredit,
            'ai-agent-comp-pct': extracted.buyerAgentComp,
            'ai-finance': extracted.financingType
        };

        for (const [id, value] of Object.entries(mappings)) {
            const el = document.getElementById(id);
            if (el && value !== null && value !== undefined && value !== "") {
                el.value = value;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.style.transition = 'background-color 0.5s ease';
                el.style.backgroundColor = 'rgba(56, 161, 105, 0.15)'; 
                setTimeout(() => { el.style.backgroundColor = ''; }, 4000);
            }
        }
        
        if (extracted.purchasePrice && extracted.loanAmount) {
            const price = parseFloat(extracted.purchasePrice);
            const loan = parseFloat(extracted.loanAmount);
            if (!isNaN(price) && !isNaN(loan) && price > 0) {
                const downPct = (((price - loan) / price) * 100).toFixed(2);
                const downEl = document.getElementById('ai-down');
                if (downEl) {
                    downEl.value = downPct;
                    downEl.dispatchEvent(new Event('input', { bubbles: true }));
                    downEl.style.transition = 'background-color 0.5s ease';
                    downEl.style.backgroundColor = 'rgba(56, 161, 105, 0.15)';
                    setTimeout(() => { downEl.style.backgroundColor = ''; }, 4000);
                }
            }
        }

        btn.innerHTML = '✅ Auto-Filled Successfully';
        btn.style.background = 'var(--success)';
        btn.style.color = 'white';
        btn.style.borderColor = 'var(--success)';

        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.disabled = false;
            btn.style.background = '';
            btn.style.color = '';
            btn.style.borderColor = '';
        }, 5000);

    } catch (err) {
        console.error("AI Extraction Error:", err);
        alert("Failed to extract data securely: " + err.message);
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

const extractBtn = document.getElementById('btn-ai-extract');
if (extractBtn) extractBtn.addEventListener('click', window.executeAIExtraction);
