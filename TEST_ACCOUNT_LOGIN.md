# Test account login (email OTP skip)

Kuch chune hue accounts mobile app mein **bina email OTP** ke login kar sakte hain. Inme naam, email aur mobile daal kar Continue dabate hi seedha selfie (camera) screen khulti hai. Baaki sab users ke liye email OTP pehle jaisa hi chalta hai.

Pehle ye kaam APK ke andar bundled passwords (`assets/testing/demo_login.json`) se hota tha. Jab bhi Firebase mein password badalta, purana APK "This testing APK needs updated demo login credentials" error deta tha. Ab ye database ke ek flag se chalta hai, aur APK mein koi password nahi chahiye.

## Kaise kaam karta hai

1. App naam, email aur mobile ke saath `POST /api/auth/test-login` call karta hai.
2. Server do cheezein check karta hai:
   - `testAccounts/{email}` document maujood ho
   - `people/{email}` mein `accountType` ki value `"test"` ho
   - naam aur mobile match hone chahiye (case, spacing, `+91` aur leading `0` ignore hote hain)
   - registration archived, `cancelled` ya `suspended` nahi honi chahiye
   - Firebase Auth account maujood ho aur disabled na ho
3. Sab sahi hai to server Firebase custom token deta hai. Token ke claims: `login_method: "test_account"`, `login_audience: "mobile"`.
4. App us token se sign in karta hai aur selfie screen kholta hai.
5. Koi bhi check fail ho to server `404 Not a test account` deta hai, aur app normal email OTP flow chalata hai.

## Database (Firestore)

**Alag collection `testAccounts`**: har test account ka ek document, jiska ID email hai. Firebase console mein ise kholte hi saare test accounts ek jagah dikh jaate hain.

| Field | Matlab |
|---|---|
| `email`, `fullName`, `mobile`, `role` | Participant ki details, add karte waqt `people` se copy ki gayi |
| `addedAt`, `addedBy`, `addedByName` | Kab aur kis Super Admin ne add kiya |
| `lastLoginAt` | App mein aakhri baar test login kab hua |

`people/{email}.accountType: "test"` bhi rakha gaya hai, taaki Participants list mein badge dikh sake. Dono hamesha ek hi transaction mein badalte hain, aur login ke liye dono zaroori hain. Ye collection mobile app ya browser se readable nahi hai, sirf server (Admin SDK) isse padhta aur likhta hai.

Neeche ke 6 demo accounts dono jagah set kiye gaye. Set karne se pehle har document ka naam, mobile aur role verify kiya gaya.

| Role | Naam | Email | Mobile |
|---|---|---|---|
| Presenter | Aarav Mehra | presenter@gmail.com | 9876543210 |
| Attendee | Riya Bhandari | attendee@gmail.com | 9876543211 |
| Speaker | Prof. Nandini Rautela | speaker@gmail.com | 9876543212 |
| VIP | Dr. Vinod Tamta | vip@gmail.com | 9876543213 |
| Organiser | Dr. Kavita Negi | organizer@gmail.com | 9876543214 |
| Volunteer | Rohit Bisht | volunteer@gmail.com | 9876543215 |

Field ka naam `category` nahi rakha gaya, kyunki `category` presenter ke paper category (Iâ€“IV) ke liye pehle se use hoti hai.

## Server aur dashboard (`cone-admin-dashboard`)

Commit `bf29705`, `main` par push ho chuka hai.

| File | Change |
|---|---|
| `server/test-accounts.ts` (nayi) | `POST /api/auth/test-login`: public, rate limit 10 per minute. `GET /api/test-accounts`: list aur server switch ka status. `PUT /api/people/:email/test-account`: body `{ "enabled": true/false }`. Dono admin endpoints sirf Super Admin ke liye |
| `src/TestAccounts.tsx` (nayi) | Sidebar mein naya page **People & access â†’ Test accounts**. Isme list hai, email se add karne ka box hai, aur har row par Remove button |
| `src/RoleWorkspace.tsx` | Sidebar group aur page description mein naya page joda |
| `server/index.ts` | Dono endpoints register kiye. Login endpoint dashboard auth middleware se pehle, admin endpoint uske baad |
| `server/email-otp.ts` | `identitySchema` aur `normalizedName` export kiye, taaki test login wahi matching use kare jo OTP karta hai |
| `src/App.tsx` | Participants â†’ Edit mein "Test account: mobile app login skips email OTP" checkbox, jo sirf Super Admin ko dikhta hai. List mein naam ke saath "Test login" badge |
| `firebase/firestore.email-otp.rules` | Ye file abhi deploy nahi hai. `test_account` sessions ko allow kiya, taaki baad mein deploy ho to test accounts block na hon |
| `.env.example` | `ALLOW_TEST_ACCOUNT_LOGIN=true` jodi |
| `tests/test-accounts.test.ts` (nayi) | 8 tests |

Aur details:
- Flag OFF karne par us account ke chalu sessions bhi revoke ho jaate hain.
- Har login aur har flag change audit log mein jaata hai: `auth.test_account.login`, `participants.test_account.on`, `participants.test_account.off`.
- Participant record save karne se flag nahi mitta, kyunki save `merge` se hota hai.

### Env switch

```dotenv
ALLOW_TEST_ACCOUNT_LOGIN=true
```

Ye line na ho ya `false` ho to `/api/auth/test-login` endpoint bilkul nahi banta, aur sab users ko OTP lagta hai. Pure feature ko band karne ka sabse tez tareeka yahi hai.

## Mobile app (`Cone`)

Ye changes push **nahi** kiye gaye. App ka developer inhe apply karega.

| File | Change |
|---|---|
| `lib/auth/participant_auth_service.dart` | Naya interface `TestAccountLogin` aur uska method `signInTestAccount(details)` |
| `lib/auth/firebase_auth_service.dart` | `signInTestAccount()` method. Naya generic helper `_authRequest()`. Token se sign-in ka common code `_signInWithToken()` mein, jise OTP aur test login dono use karte hain. `restore()` ab `test_account` sessions bhi accept karta hai |
| `lib/auth/direct_demo_auth_service.dart` | `TestAccountLogin` implement karta hai aur call `FirebaseAuthService` ko pass karta hai |
| `lib/screens/login_screen.dart` | Continue dabane par sabse pehle test login try hota hai, uske baad demo/OTP. Selfie/dashboard par jaane ka code `_openHome()` mein nikaala |
| `test/widget_test.dart` | 7 naye tests: har role ka test account OTP skip karta hai, aur jo account test nahi hai wo OTP hi verify karta hai |
| `ROLE_DATA.md` | Sign-in docs update kiye |

## Testing

| Check | Result |
|---|---|
| Server unit tests | 217 mein se 216 pass. 10 naye tests sab pass. Ek purana audit pagination test fail hai, jo in changes se pehle bhi fail tha |
| Dashboard typecheck (frontend + server) | Pass |
| Flutter `flutter analyze` | No issues |
| Flutter `flutter test` | 71/71 pass |
| Real Firebase ke saath end-to-end (local API) | Presenter ko token mila. Token se Firebase sign-in hua, claims `test_account` / `mobile` aaye, aur apna `people` document padh paya (200). Galat mobile par 404 aaya |
| Asli phone par | Nahi chalaya |

## Deploy steps

1. **Server env** (`/var/www/cone/.env`, ye file `ls -a` se dikhti hai):
   ```bash
   cd /var/www/cone
   cp .env .env.backup
   nano .env        # end mein ALLOW_TEST_ACCOUNT_LOGIN=true jodo
   ```
2. **Deploy:**
   ```bash
   /var/www/cone/deploy/deploy.sh
   ```
3. **Check:**
   ```bash
   curl -s -X POST https://cone.ved.bio/api/auth/test-login \
     -H 'Content-Type: application/json' \
     -d '{"name":"Aarav Mehra","email":"presenter@gmail.com","mobile":"9876543210"}' | head -c 80; echo
   ```
   - `{"token":"...` aaye to sab sahi hai.
   - `Sign in to continue` aaye to ya to deploy nahi hua, ya env line load nahi hui.
4. **APK:** app ke changes apply karke naya APK build karo, aur `AUTH_API_URL` mein naye API server ka address do (live: `https://cone.ved.bio`).

## Naya test account kaise banayein ya hatayein

- **Test accounts page se (sabse aasaan):** Super Admin login â†’ sidebar mein **People & access â†’ Test accounts** â†’ participant ka email daal kar **Add test account** dabao. Hatane ke liye us row par **Remove** dabao. Page par ye bhi dikhta hai ki kisne kab add kiya aur aakhri app login kab hua. Server switch off ho to page ke upar warning aati hai.
- **Participants page se:** Participants â†’ us person par Edit â†’ "Test account" checkbox ON ya OFF.
- Dono tareekon se change turant save hota hai, aur naya APK nahi chahiye.
- **API se:** `PUT /api/people/<email>/test-account` body `{"enabled": true}` (Super Admin token chahiye).

## Security

- Jis account par flag ON hai, uska naam, email aur mobile jaanne wala koi bhi us account mein login kar sakta hai. **Ye flag sirf test/demo accounts par lagana, real participants par kabhi nahi.**
- Flag sirf Super Admin badal sakta hai, aur har change audit log mein hai.
- Conference ke time pura feature band karna ho to server par `ALLOW_TEST_ACCOUNT_LOGIN=false` karke `systemctl restart cone-api cone-worker` chalao.
