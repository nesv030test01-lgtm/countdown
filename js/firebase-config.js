// 1) Vào https://console.firebase.google.com → tạo project
// 2) Project settings → General → "Your apps" → thêm Web app (</>)
// 3) Copy object firebaseConfig dán đè lên bên dưới.
// Các giá trị này được phép công khai trên GitHub — bảo mật nằm ở firestore.rules.
export const firebaseConfig = {
  apiKey: "AIzaSyB6l0J5OuST5-egDiZZBymd7FVg0Sz7EjY",
  authDomain: "di-chua-online-a850f.firebaseapp.com",
  projectId: "di-chua-online-a850f",
  storageBucket: "di-chua-online-a850f.firebasestorage.app",
  messagingSenderId: "327970732342",
  appId: "1:327970732342:web:8645c8df09bd97687f9b97",
  measurementId: "G-LQMRM4PBMZ",
};

export const isConfigured = !firebaseConfig.apiKey.startsWith("YOUR_");
