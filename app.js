import { 
    auth, db, createUserWithEmailAndPassword, signInWithEmailAndPassword, 
    onAuthStateChanged, signOut, updateProfile, doc, setDoc, getDoc,
    collection, addDoc, query, where, onSnapshot, getDocs, sendPasswordResetEmail, deleteDoc
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
            }).catch(e => console.error("Error checking RBAC:", e));

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
            if (path.includes('index.html') || path === '/' || path.endsWith('real_estate_offer_portal/')) {
                const listingsContainer = document.getElementById('listings-container');
                if (listingsContainer) {
                    const q = query(collection(db, "properties"), where("agentId", "==", user.uid));
                    onSnapshot(q, (querySnapshot) => {
                        listingsContainer.innerHTML = ''; // Clear loading text
                        if (querySnapshot.empty) {
                            listingsContainer.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: var(--surface); border-radius: var(--radius-md);"><p class="text-muted">You have no active listings. Create one to get started!</p></div>';
                            return;
                        }
                        
                        querySnapshot.forEach((docSnap) => {
                            const data = docSnap.data();
                            const id = docSnap.id;
                            
                            const card = document.createElement('div');
                            card.className = 'card';
                            card.innerHTML = `
                                <div style="height: 160px; background-color: #E2E8F0; border-radius: var(--radius-md); margin-bottom: 1rem; background-image: url('${data.imageUrl || 'https://images.unsplash.com/photo-1518780664697-55e3ad937233?auto=format&fit=crop&w=400&q=80'}'); background-size: cover; background-position: center; position: relative;">
                                    <div style="position: absolute; top: 0.5rem; right: 0.5rem; display: flex; gap: 0.5rem;">
                                        <button class="btn btn-outline delete-prop-btn" data-id="${id}" style="background: white; padding: 0.25rem 0.5rem; font-size: 0.8rem; border: 1px solid var(--danger); color: var(--danger); box-shadow: var(--shadow-sm);">🗑️ Delete</button>
                                        <a href="edit_property.html?id=${id}" class="btn btn-outline" style="background: white; padding: 0.25rem 0.5rem; font-size: 0.8rem; border: 1px solid var(--border); box-shadow: var(--shadow-sm);">✏️ Edit</a>
                                    </div>
                                </div>
                                <h3 style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${data.address}">${data.address}</h3>
                                <p class="text-muted mb-4">${data.askingPrice} • <span id="offer-count-${id}">Loading Offers...</span></p>
                                <div class="flex justify-between mt-4">
                                    <a href="offer_management.html?id=${id}" class="btn btn-primary" style="width: 48%; text-align: center;">View Offers</a>
                                    <a href="offer_submission.html?id=${id}" class="btn btn-outline" style="width: 48%; text-align: center;">Portal Link</a>
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
                            
                            // Fetch real offer count
                            getDocs(query(collection(db, "offers"), where("propertyId", "==", id))).then(snap => {
                                const el = document.getElementById(`offer-count-${id}`);
                                if (el) el.innerText = `${snap.size} Offer${snap.size !== 1 ? 's' : ''}`;
                            });
                        });
                    }, (error) => {
                        console.error("Error fetching properties:", error);
                        listingsContainer.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: var(--surface); border-radius: var(--radius-md);"><p class="text-danger">Error loading properties. Make sure Firestore is initialized in Test Mode.</p></div>';
                    });
                }
            }

            // Load Edit Property Data
            if (path.includes('edit_property.html')) {
                const urlParams = new URLSearchParams(window.location.search);
                const propertyId = urlParams.get('id');
                if (propertyId) {
                    getDoc(doc(db, "properties", propertyId)).then(docSnap => {
                        if (docSnap.exists() && docSnap.data().agentId === user.uid) {
                            const data = docSnap.data();
                            document.getElementById('edit-address').value = data.address || '';
                            document.getElementById('edit-price').value = data.askingPrice || '';
                            document.getElementById('edit-desc').value = data.description || '';
                            
                            // Load owner details if they exist
                            const ownerNameEl = document.getElementById('edit-owner-name');
                            const ownerEmailEl = document.getElementById('edit-owner-email');
                            const ownerMobileEl = document.getElementById('edit-owner-mobile');
                            if(ownerNameEl) ownerNameEl.value = data.ownerName || '';
                            if(ownerEmailEl) ownerEmailEl.value = data.ownerEmail || '';
                            if(ownerMobileEl) ownerMobileEl.value = data.ownerMobile || '';

                        } else {
                            alert("Property not found or unauthorized.");
                            window.location.href = 'index.html';
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

    // 6. Team Invite Form Handler
    const teamInviteForm = document.getElementById('team-invite-form');
    if (teamInviteForm) {
        teamInviteForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('btn-send-invite');
            btn.disabled = true;
            btn.innerText = 'Inviting...';
            
            const user = auth.currentUser;
            if (!user) return;

            const email = document.getElementById('invite-email').value;
            const role = document.getElementById('invite-role').value;

            try {
                const userDoc = await getDoc(doc(db, "users", user.uid));
                let team = [];
                if (userDoc.exists()) {
                    team = userDoc.data().team || [];
                }
                
                if (team.find(m => m.email.toLowerCase() === email.toLowerCase())) {
                    alert("This user is already on your team.");
                } else {
                    team.push({ email: email, role: role });
                    await setDoc(doc(db, "users", user.uid), { team: team }, { merge: true });
                    document.getElementById('invite-email').value = '';
                    if (window.refreshTeam) window.refreshTeam();
                }
            } catch (error) {
                console.error("Error inviting team member:", error);
                alert("Error inviting member: " + error.message);
            } finally {
                btn.disabled = false;
                btn.innerText = 'Send Invite';
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
            
            // Optional owner details
            const ownerNameEl = document.getElementById('prop-owner-name');
            const ownerEmailEl = document.getElementById('prop-owner-email');
            const ownerMobileEl = document.getElementById('prop-owner-mobile');
            const ownerName = ownerNameEl ? ownerNameEl.value : '';
            const ownerEmail = ownerEmailEl ? ownerEmailEl.value : '';
            const ownerMobile = ownerMobileEl ? ownerMobileEl.value : '';

            try {
                let finalImageUrl;
                if (fileInput && fileInput.files && fileInput.files.length > 0) {
                    finalImageUrl = await compressImage(fileInput.files[0]);
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
                    createdAt: new Date(),
                    status: 'active',
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
            
            // Optional owner details
            const ownerNameEl = document.getElementById('edit-owner-name');
            const ownerEmailEl = document.getElementById('edit-owner-email');
            const ownerMobileEl = document.getElementById('edit-owner-mobile');
            const ownerName = ownerNameEl ? ownerNameEl.value : '';
            const ownerEmail = ownerEmailEl ? ownerEmailEl.value : '';
            const ownerMobile = ownerMobileEl ? ownerMobileEl.value : '';

            try {
                let updates = {
                    address: address,
                    askingPrice: price,
                    description: desc,
                    ownerName: ownerName,
                    ownerEmail: ownerEmail,
                    ownerMobile: ownerMobile
                };
                
                if (fileInput && fileInput.files && fileInput.files.length > 0) {
                    updates.imageUrl = await compressImage(fileInput.files[0]);
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

        // Capture uploaded document names
        const docs = [];
        const fileRpa = document.getElementById('ai-file-rpa');
        const fileFunds = document.getElementById('ai-file-funds');
        const filePreapproval = document.getElementById('ai-file-preapproval');
        
        if (fileRpa && fileRpa.files) {
            for(let i = 0; i < fileRpa.files.length; i++) {
                docs.push({ type: 'Purchase Agreement', name: fileRpa.files[i].name });
            }
        }
        if (fileFunds && fileFunds.files) {
            for(let i = 0; i < fileFunds.files.length; i++) {
                docs.push({ type: 'Proof of Funds', name: fileFunds.files[i].name });
            }
        }
        if (filePreapproval && filePreapproval.files) {
            for(let i = 0; i < filePreapproval.files.length; i++) {
                docs.push({ type: 'Pre-Approval', name: filePreapproval.files[i].name });
            }
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
            const sellerLink = document.getElementById('link-seller-presentation');
            if (manualLink) manualLink.href = `manual_offer.html?id=${propertyId}`;
            if (sellerLink) sellerLink.href = `seller_presentation.html?id=${propertyId}`;

            // Fetch property details for header
            getDoc(doc(db, "properties", propertyId)).then(async (docSnap) => {
                if (docSnap.exists()) {
                    const propData = docSnap.data();
                    const header = document.getElementById('prop-address-header');
                    if (header) header.innerText = propData.address;
                    
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
            }).catch(err => console.error("Error fetching property:", err));

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

                    querySnapshot.forEach((docSnap) => {
                        const data = docSnap.data();
                        const offerId = docSnap.id;
                        const priceVal = parseInt((data.price || "0").replace(/\D/g, ""));
                        const isHighest = priceVal === highestPrice && priceVal > 0;
                        
                        const borderColor = isHighest ? 'var(--success)' : 'var(--border)';
                        const highestBadge = isHighest ? `<span class="badge" style="background-color: rgba(56, 161, 105, 0.1); color: var(--success); margin-left: 0.5rem;">Highest Offer</span>` : '';

                        
                        window.offerDocumentsCache = window.offerDocumentsCache || {};
                        window.offerDocumentsCache[offerId] = data.documents || [];

                        const isSellerView = window.location.pathname.includes('seller_presentation.html');

                        const actionButtonsHtml = isSellerView ? '' : `
                            <div style="display: flex; flex-direction: column; gap: 0.5rem; align-items: stretch;">
                                ${data.status === 'accepted' 
                                    ? `<button class="btn btn-success" style="background-color: var(--success); color: white;" onclick="window.undoAcceptOffer('${offerId}')">✓ Offer Accepted (Undo)</button>` 
                                    : `<button class="btn btn-outline" id="btn-accept-${offerId}" onclick="window.acceptOffer('${offerId}', 'offer-${offerId}-dates')">Accept Offer</button>`}
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

                        card.innerHTML = `
                            <div class="flex justify-between items-center mb-4 border-bottom pb-4" style="border-bottom: 1px solid var(--border); padding-bottom: 1rem;">
                                <div>
                                    <h3 style="font-size: 1.5rem; margin-bottom: 0.5rem;">${data.price} ${highestBadge}</h3>
                                    <p class="text-muted" style="margin-bottom: 0.5rem;">${data.financingType} Loan • ${data.downPaymentPercent}% Down • By: ${data.buyerAgentName} (${data.buyerAgentBrokerage || 'Independent'})</p>
                                    ${data.buyerAgentCompPct ? `<p class="text-muted" style="margin-bottom: 0.5rem;"><strong>Buyer Agent Comp:</strong> ${data.buyerAgentCompPct}% ($${parseFloat(data.buyerAgentCompDollar).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})})</p>` : ''}
                                    ${data.sellerCredit ? `<p class="text-muted" style="margin-bottom: 0.5rem;"><strong>Seller Credit:</strong> ${data.sellerCredit}</p>` : ''}
                                    <div style="display: flex; gap: 0.5rem; font-size: 0.8rem; flex-wrap: wrap;" id="offer-${offerId}-dates">
                                        <span style="background: var(--background); padding: 0.25rem 0.5rem; border-radius: 4px; border: 1px solid var(--border);"><strong>Deposit:</strong> ${data.deposit}</span>
                                        <span style="background: var(--background); padding: 0.25rem 0.5rem; border-radius: 4px; border: 1px solid var(--border);" class="calc-date" data-days="${data.coeDays}"><strong>COE:</strong> ${data.coeDays} Days</span>
                                        <span style="background: var(--background); padding: 0.25rem 0.5rem; border-radius: 4px; border: 1px solid var(--border);" class="calc-date" data-days="${data.loanDays}"><strong>Loan:</strong> ${data.loanDays} Days</span>
                                        <span style="background: var(--background); padding: 0.25rem 0.5rem; border-radius: 4px; border: 1px solid var(--border);" class="calc-date" data-days="${data.appraisalDays}"><strong>Appraisal:</strong> ${data.appraisalDays} Days</span>
                                        <span style="background: var(--background); padding: 0.25rem 0.5rem; border-radius: 4px; border: 1px solid var(--border);" class="calc-date" data-days="${data.inspectionDays}"><strong>Inspection:</strong> ${data.inspectionDays} Days</span>
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
window.acceptOffer = async (offerId, containerId) => {
    let today = new Date().toISOString().split('T')[0];
    let acceptedDateStr = prompt("Enter the date the offer was accepted (YYYY-MM-DD):", today);
    if (!acceptedDateStr) return; 
    
    let acceptedDate = new Date(acceptedDateStr + "T00:00:00"); 
    if (isNaN(acceptedDate.getTime())) {
        alert("Invalid date format. Please use YYYY-MM-DD.");
        return;
    }

    const container = document.getElementById(containerId);
    if (!container) return;

    const dateSpans = container.querySelectorAll('.calc-date');
    dateSpans.forEach(span => {
        let days = parseInt(span.getAttribute('data-days'), 10);
        if (!isNaN(days)) {
            let targetDate = new Date(acceptedDate);
            targetDate.setDate(targetDate.getDate() + days);
            let formattedDate = targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            let label = span.querySelector('strong').innerText;
            span.innerHTML = `<strong style="color: var(--success);">${label}</strong> ${formattedDate}`;
            span.style.borderColor = 'var(--success)';
            span.style.backgroundColor = 'rgba(56, 161, 105, 0.05)';
        }
    });

    const btn = document.getElementById(`btn-accept-${offerId}`);
    if (btn) {
        btn.innerText = "Saving...";
        btn.disabled = true;
    }

    try {
        await setDoc(doc(db, "offers", offerId), {
            status: 'accepted',
            acceptedDate: acceptedDate
        }, { merge: true });
        
        alert(`Offer accepted on ${acceptedDate.toLocaleDateString('en-US')}!\n\nAll contingency and COE dates have been automatically calculated based on the days specified in the offer. Status securely saved to database.`);
    } catch(err) {
        console.error("Error saving accepted status:", err);
        alert("Calculated dates, but error saving status to database: " + err.message);
    }
};

window.undoAcceptOffer = async (offerId) => {
    if (confirm("Are you sure you want to un-accept this offer?\n\nThis will reset the offer status and all calculated contingency dates will revert to their original timeline.")) {
        try {
            await setDoc(doc(db, "offers", offerId), {
                status: 'pending',
                acceptedDate: null
            }, { merge: true });
        } catch(err) {
            console.error("Error undoing offer:", err);
            alert("Error: " + err.message);
        }
    }
};

window.viewDocuments = (offerId) => {
    const docs = window.offerDocumentsCache ? window.offerDocumentsCache[offerId] : null;
    if (!docs || docs.length === 0) {
        alert("No documents were uploaded with this specific offer.");
        return;
    }
    
    let docList = docs.map(d => `• ${d.type}: ${d.name}`).join('\n');
    alert(`Attached Documents for Review:\n\n${docList}\n\n[Prototype Note: In a production environment, clicking this would open these PDFs directly from Firebase Storage.]`);
};

window.simulateAIAutoFill = () => {
    const btn = document.getElementById('btn-ai-autofill');
    if (!btn) return;

    const originalText = btn.innerHTML;
    btn.innerHTML = '✨ Analyzing PDF... <span style="font-size: 0.8rem; margin-left: 0.5rem; opacity: 0.8;">(Simulated)</span>';
    btn.disabled = true;
    btn.style.opacity = '0.8';

    setTimeout(() => {
        const mockData = {
            'ai-price': '925000',
            'ai-deposit': '27750',
            'ai-down': '20',
            'ai-finance': 'Conventional',
            'ai-coe': '30',
            'ai-loan': '21',
            'ai-appraisal': '17',
            'ai-inspection': '10'
        };

        for (const [id, value] of Object.entries(mockData)) {
            const el = document.getElementById(id);
            if (el) {
                el.value = value;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.style.transition = 'background-color 0.5s ease';
                el.style.backgroundColor = 'rgba(124, 58, 237, 0.1)';
                setTimeout(() => { el.style.backgroundColor = ''; }, 3000);
            }
        }

        btn.innerHTML = '✅ AI Extraction Complete';
        btn.style.background = 'var(--success)';
        btn.style.boxShadow = 'none';
        alert("✨ AI successfully extracted the offer details from the Purchase Agreement.\n\nPlease review the highlighted fields for accuracy before submitting.");

        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.disabled = false;
            btn.style.background = '';
            btn.style.boxShadow = '';
        }, 5000);
    }, 2500); 
};
