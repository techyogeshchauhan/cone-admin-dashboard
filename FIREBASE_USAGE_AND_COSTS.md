# Firebase usage, limits aur production cost

_21 October 2026 · Firebase project: `conferencemanagement-239a3`_

## 1. Limit kyun hit hui

Firebase Console me exact breakdown dekh sakte ho: **Firestore → Usage**. Code ke hisaab se sabse bada hissa ye tha:

| Wajah | Reads | Ab |
|---|---|---|
| Email worker har 3 second me 2 reads (khali queue pe bhi) | ~2,400/ghanta. `npm run dev` 10 ghante chale to ~24,000, poore din chale to 57,600 | ✅ theek: real-time listener, khali queue pe 0 reads |
| Branding polling: har khuli tab har 30 second | ~240/ghanta per tab | ✅ 5 minute + server cache |
| Har API call pe 4–5 reads (login check, role, settings) | 100 API calls = ~500 reads | ✅ 30 second cache |
| Overview har baar saare participants padhta tha | 260 reads per view | ✅ 60 second cache |
| Import (3 koshishen) + report + testing/measurement | kuch hazaar | (ek baar ka kaam) |

Ek din me `npm run dev` lambe samay chala, uske upar import aur testing hui, aur **50,000 ki limit paar ho gayi.**

## 2. Abhi ka plan (Spark, free): limits

Hamara database: **asia-east1 (Taiwan), Standard edition**.

| Service | Free limit | Hum kitna use karte hain |
|---|---|---|
| **Firestore reads** | **50,000 / din** | ⚠️ sabse tight limit |
| **Firestore writes** | 20,000 / din | theek |
| Firestore deletes | 20,000 / din | bahut kam |
| **Firestore storage** | **1 GiB** | 2,000 participants pe bhi ~20–50 MB, koi dikkat nahi |
| Network egress | 10 GiB / mahina | 3-din ke conference me ~1–3 GB |
| **Auth (email/OTP users)** | **50,000 monthly active users** | koi dikkat nahi |
| **Auth phone SMS** | **Spark me available hi nahi** | ⚠️ **Super Admin MFA SMS se hota hai, ye Blaze ke bina nahi chalega** |
| Cloud Storage (files) | 5 GB (sirf US buckets pe free) | **use nahi karte.** Logo, selfies, media VPS ki `storage/` folder me hain |
| Firebase Hosting | 10 GB storage, 360 MB/din transfer | sirf app-link file ke liye |

Daily limits **12:30 IST** (Pacific midnight) pe reset hoti hain.

## 3. Har operation kitne reads/writes leta hai (code se gina)

Firestore security rules ke andar ke `get()` bhi reads me gine jaate hain, wo bhi isme shaamil hain.

| Operation | Reads | Writes |
|---|---|---|
| Participant OTP login (request + verify) | 9 | 10 |
| App kholna (profile, conference, branding, coupons) | ~12 | 0 |
| Ek meal coupon scan (meal desk) | ~12 | 1 |
| Organiser ka **People screen** kholna (mobile app) | **saare participants (P)** | 0 |
| Dashboard Overview (cache ke baad) | P, max 1 baar/minute | 0 |
| Dashboard list ka ek page | ~26 | 0 |
| Import, per row | ~3 | ~4 |
| Ek bulk email | ~3 | ~2 |

OTP session 24 ghante chalta hai (rules me set hai), isliye har participant **roz ek baar** login karega.

## 4. Production calculation (conference ka ek din)

**Maan ke chala:**

- har participant: din me 1 login, 10 baar app kholna, 3 meal scans
- 10 organisers, har ek din me 5 baar People screen kholta hai
- 5 admins dashboard pe, overview 20 baar dekha jaata hai

**Formula:** reads ≈ 235 × P + 15,000 · writes ≈ 13 × P + 500

| Participants (P) | Reads/din | Free 50K? | Writes/din | Free 20K? |
|---|---|---|---|---|
| **260** (abhi) | ~76,000 | ❌ **paar** | ~3,900 | ✅ |
| 500 | ~1,32,000 | ❌ | ~7,000 | ✅ |
| 1,000 | ~2,50,000 | ❌ | ~13,500 | ✅ |
| 2,000 | ~4,85,000 | ❌ | ~26,500 | ❌ |
| 5,000 | ~11,90,000 | ❌ | ~65,500 | ❌ |

**Limit kab hit hogi:**

- **Reads:** sirf **~150 participants** active hon, tabhi.
- **Writes:** ~1,500 participants pe.

**Matlab free plan kisi bhi asli conference din ke liye kaafi nahi hai.**

Sabse bada akela hissa mobile app ka **People screen** hai (har baar saare participants padhta hai): 2,000 participants pe ~1 lakh reads/din. Ise paginate karna agla zaroori kaam hai, jaise dashboard me kiya.

## 5. Blaze plan pe kharcha

Blaze me bhi upar wala free hissa (50K reads, 20K writes roz) muft rehta hai. Sirf usse upar ka paisa lagta hai.

Region ka exact rate official page se nahi nikal paaya, isliye maine sabse **mehenga** rate liya hai: reads $0.06 aur writes $0.18 per 1 lakh. Asli kharcha isse kam hi hoga.

| Participants | Kharcha / din | 3-din conference |
|---|---|---|
| 260 | ~$0.02 (₹2) | ~₹5 |
| 1,000 | ~$0.12 (₹10) | ~₹30 |
| 2,000 | ~$0.27 (₹23) | ~₹70 |
| 5,000 | ~$0.77 (₹65) | ~₹200 |

Super Admin MFA ke SMS ka kharcha alag hai, per SMS lagta hai.

## Salah

1. **Conference se pehle Blaze plan le lo**, aur **budget alert** laga do (jaise ₹500/mahina), taaki kabhi bhi bina bataye kharcha na badhe. Super Admin MFA (SMS) ke liye bhi Blaze zaroori hai.
2. **Mobile app ka People screen paginate karo.** Ye sabse bada reads ka kharcha hai.
3. Database Taiwan (asia-east1) me hai. India ke users ke liye Mumbai (asia-south1) tez hota, lekin location baad me badli nahi ja sakti. Abhi ke liye ye theek hai.

## Sources

- [Firebase Pricing](https://firebase.google.com/pricing)
- [Firestore billing rules (Firebase docs)](https://firebase.google.com/docs/firestore/pricing)
- [Firestore pricing (Google Cloud)](https://cloud.google.com/firestore/pricing)
- [Firestore Enterprise pricing](https://firebase.google.com/docs/firestore/enterprise/pricing)
- [GitHub issue: Firestore regional rates (third-party, unverified)](https://github.com/ravitejakamalapuram/InvTrack/issues/803)
- [Firebase Pricing 2026 (third-party)](https://magora-systems.com/firebase-pricing/)
- [Firestore Pricing Explained (third-party)](https://firemap.dev/blog/firestore-pricing-explained)
