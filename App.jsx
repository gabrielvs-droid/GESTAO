import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
Upload,
Camera,
QrCode,
DollarSign,
PieChart,
Calendar,
X,
FileText,
Image as ImageIcon,
Loader2,
Trash2,
AlertCircle,
Printer,
Filter,
Edit3
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore';

// --- Firebase Initialization ---
let app, auth, db, appId;
try {
const firebaseConfig = JSON.parse(typeof \__firebase_config !== 'undefined' ? \__firebase_config : '{}');
app = initializeApp(firebaseConfig);
auth = getAuth(app);
db = getFirestore(app);
appId = typeof \__app_id !== 'undefined' ? \__app_id : 'default-app-id';
} catch (error) {
console.error("Firebase initialization failed:", error);
}

// --- Helper: Resize Image (CRÍTICO para evitar limite de 1MB do Firestore) ---
const resizeImage = (file) => {
return new Promise((resolve, reject) => {
const reader = new FileReader();
reader.readAsDataURL(file);
reader.onload = (event) => {
const img = new Image();
img.src = event.target.result;
img.onload = () => {
const canvas = document.createElement('canvas');
const MAX_WIDTH = 400;
const MAX_HEIGHT = 400;
let width = img.width;
let height = img.height;

```
    if (width > height) {
      if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
    } else {
      if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
    }

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    
    resolve(canvas.toDataURL('image/jpeg', 0.5));
  };
  img.onerror = (err) => reject(err);
};
reader.onerror = (err) => reject(err);

```

});
};

// --- Helper: Parse Valor ---
const parseValorSeguro = (valorRaw) => {
if (typeof valorRaw === 'number') return valorRaw;
if (!valorRaw) return 0;
const formatado = String(valorRaw).replace(',', '.').replace(/\[^0-9.-\]+/g, "");
return Number(formatado) || 0;
};

// --- Helper: Call Gemini API ---
const analyzeReceiptWithGemini = async (base64String) => {
const apiKey = ""; // Canvas runtime provides the key
const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;

const base64Data = base64String.includes(',') ? base64String.split(',')\[1\] : base64String;

const payload = {
contents: \[
{
role: "user",
parts: \[
{
text: `Analyze this receipt. Return ONLY a raw JSON object with no markdown formatting, no backticks, no text before or after. Keys must be: 'classe' (e.g., Casa, Transporte, Saúde, Alimentação), 'subclasse' (e.g., Luz, Água, Remédios), 'valor' (number only, no currency symbols), 'descricao' (short string), 'dataNota' (the date printed on the receipt in YYYY-MM-DD format if visible, otherwise null).`
},
{ inlineData: { mimeType: "image/jpeg", data: base64Data } }
\]
}
\]
};

let rawText = "";
try {
const response = await fetch(apiUrl, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify(payload)
});

```
if (!response.ok) {
  throw new Error(`Falha na API da IA (${response.status})`);
}

const data = await response.json();
rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

if (!rawText) throw new Error("A IA retornou uma resposta vazia.");

const firstBrace = rawText.indexOf('{');
const lastBrace = rawText.lastIndexOf('}');

if (firstBrace === -1 || lastBrace === -1) {
  throw new Error("Nenhum objeto JSON encontrado na resposta da IA.");
}

const jsonStr = rawText.substring(firstBrace, lastBrace + 1);
return JSON.parse(jsonStr);

```

} catch (error) {
console.error("Gemini API Error:", error);
const customError = new Error(error.message);
customError.rawText = rawText || "Sem resposta em texto";
throw customError;
}
};

export default function App() {
const \[user, setUser\] = useState(null);
const \[transactions, setTransactions\] = useState(\[\]);

const \[statusMsg, setStatusMsg\] = useState('');
const \[errorMsg, setErrorMsg\] = useState('');
const \[debugRawText, setDebugRawText\] = useState('');

const \[selectedTransaction, setSelectedTransaction\] = useState(null);
const \[showQrModal, setShowQrModal\] = useState(false);
const \[timeFilter, setTimeFilter\] = useState('monthly');

const \[showPrintView, setShowPrintView\] = useState(false);
const \[isEditing, setIsEditing\] = useState(false);
const \[editData, setEditData\] = useState({ classe: '', subclasse: '', descricao: '', valor: '', data: '' });

const \[showManualForm, setShowManualForm\] = useState(false);
const \[manualData, setManualData\] = useState({ classe: '', subclasse: '', descricao: '', valor: '', data: new Date().toISOString().split('T')\[0\] });

const fileInputRef = useRef(null);
const cameraInputRef = useRef(null);

// --- Auth & Data Fetching ---
useEffect(() => {
if (!auth) return;
const initAuth = async () => {
try {
if (typeof \__initial_auth_token !== 'undefined' && \__initial_auth_token) {
await signInWithCustomToken(auth, \__initial_auth_token);
} else {
await signInAnonymously(auth);
}
} catch (err) {
console.error("Auth Error:", err);
setErrorMsg("Falha na autenticação do sistema.");
}
};
initAuth();

```
const unsubscribe = onAuthStateChanged(auth, (u) => setUser(u));
return () => unsubscribe();

```

}, \[\]);

useEffect(() => {
if (!user || !db) return;
const txRef = collection(db, 'artifacts', appId, 'public', 'data', 'transactions');
const unsubscribe = onSnapshot(txRef, (snapshot) => {
const txs = \[\];
snapshot.forEach((doc) => txs.push({ id: doc.id, ...doc.data() }));
txs.sort((a, b) => {
const dateA = a.data || new Date(a.createdAt).toISOString().split('T')\[0\];
const dateB = b.data || new Date(b.createdAt).toISOString().split('T')\[0\];
return dateB.localeCompare(dateA) || (b.createdAt - a.createdAt);
});
setTransactions(txs);
}, (err) => {
console.error("Snapshot error:", err);
setErrorMsg("Erro ao carregar o banco de dados compartilhado.");
});
return () => unsubscribe();
}, \[user\]);

// --- Actions ---
const handleFileUpload = async (event) => {
const file = event.target.files?.\[0\];
if (!file) return;

```
setErrorMsg('');
setDebugRawText('');

try {
  setStatusMsg('Comprimindo imagem (Máx 400px)...');
  const base64Img = await resizeImage(file);
  
  setStatusMsg('Enviando para IA Gemini...');
  const receiptData = await analyzeReceiptWithGemini(base64Img);
  
  setStatusMsg('Salvando no Banco de Dados...');
  if (user && db) {
    const txRef = collection(db, 'artifacts', appId, 'public', 'data', 'transactions');
    
    // Data da nota impressa ou data/hora atual de upload se não houver na nota
    const notaDataValida = receiptData.dataNota && /^\d{4}-\d{2}-\d{2}$/.test(receiptData.dataNota) 
      ? receiptData.dataNota 
      : new Date().toISOString().split('T')[0];

    const newTransaction = {
      estabelecimento: receiptData.descricao || 'Automático',
      classe: receiptData.classe || 'Outros',
      subclasse: receiptData.subclasse || 'Geral',
      descricao: receiptData.descricao || 'Sem descrição',
      valor: parseValorSeguro(receiptData.valor),
      data: notaDataValida,
      imageUrl: base64Img,
      createdAt: Date.now()
    };
    
    await addDoc(txRef, newTransaction);
    setStatusMsg(''); 
  } else {
    throw new Error("Sistema offline. Tente recarregar a página.");
  }
} catch (err) {
  console.error("Processing error:", err);
  setErrorMsg(`Erro Crítico: ${err.message}`);
  setDebugRawText(err.rawText || "Nenhum dado bruto retornado pela IA.");
  setStatusMsg('');
} finally {
  if (fileInputRef.current) fileInputRef.current.value = '';
  if (cameraInputRef.current) cameraInputRef.current.value = '';
}

```

};

const handleManualSubmit = async (e) => {
e.preventDefault();
setErrorMsg('');
setDebugRawText('');
setStatusMsg('Salvando lançamento manual...');

```
try {
  if (user && db) {
    const txRef = collection(db, 'artifacts', appId, 'public', 'data', 'transactions');
    const newTransaction = {
      estabelecimento: manualData.descricao,
      classe: manualData.classe,
      subclasse: manualData.subclasse,
      descricao: manualData.descricao,
      valor: parseValorSeguro(manualData.valor),
      data: manualData.data || new Date().toISOString().split('T')[0],
      imageUrl: null,
      createdAt: Date.now()
    };
    
    await addDoc(txRef, newTransaction);
    setStatusMsg(''); 
    setShowManualForm(false);
    setManualData({ classe: '', subclasse: '', descricao: '', valor: '', data: new Date().toISOString().split('T')[0] });
  }
} catch (err) {
  setErrorMsg(`Erro ao salvar manualmente: ${err.message}`);
  setStatusMsg('');
}

```

};

const handleDelete = async (id) => {
if (!user || !db) return;
try {
await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'transactions', id));
if (selectedTransaction?.id === id) setSelectedTransaction(null);
} catch (err) {
setErrorMsg("Erro ao excluir o registro.");
}
};

const handleUpdate = async (e) => {
e.preventDefault();
if (!user || !db || !selectedTransaction) return;
try {
const txRef = doc(db, 'artifacts', appId, 'public', 'data', 'transactions', selectedTransaction.id);
const updatedTx = {
...selectedTransaction,
classe: editData.classe,
subclasse: editData.subclasse,
descricao: editData.descricao,
estabelecimento: editData.descricao,
valor: parseValorSeguro(editData.valor),
data: editData.data || selectedTransaction.data,
};
await updateDoc(txRef, updatedTx);
setSelectedTransaction(updatedTx);
setIsEditing(false);
} catch (err) {
setErrorMsg(`Erro ao atualizar: ${err.message}`);
}
};

// --- Derived State (Filtering & Calculations) ---
const filteredTransactions = useMemo(() => {
const now = new Date();
const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
const startOfQuarter = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) \* 3, 1).getTime();
const startOfYear = new Date(now.getFullYear(), 0, 1).getTime();

```
return transactions.filter(tx => {
  let txTime = tx.createdAt;
  if (tx.data) {
    const parsed = new Date(`${tx.data}T12:00:00Z`).getTime();
    if (!isNaN(parsed)) txTime = parsed;
  }

  switch(timeFilter) {
    case 'daily': return txTime >= startOfToday;
    case 'monthly': return txTime >= startOfMonth;
    case 'quarterly': return txTime >= startOfQuarter;
    case 'yearly': return txTime >= startOfYear;
    default: return true;
  }
});

```

}, \[transactions, timeFilter\]);

const { totalAmount, categoryTotals } = useMemo(() => {
let total = 0;
const cats = {};

```
filteredTransactions.forEach(tx => {
  const amt = tx.valor || 0;
  total += amt;
  const main = tx.classe || 'Outros';
  const sub = tx.subclasse || 'Geral';

  if (!cats[main]) cats[main] = { amount: 0, subCategories: {} };
  cats[main].amount += amt;
  cats[main].subCategories[sub] = (cats[main].subCategories[sub] || 0) + amt;
});

const sortedCats = Object.entries(cats).map(([name, data]) => ({
  name,
  amount: data.amount,
  subCategories: Object.entries(data.subCategories)
    .map(([subName, subAmt]) => ({ name: subName, amount: subAmt }))
    .sort((a, b) => b.amount - a.amount)
})).sort((a, b) => b.amount - a.amount);

return { totalAmount: total, categoryTotals: sortedCats };

```

}, \[filteredTransactions\]);

const formatCurrency = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
const formatDate = (dateStr) => {
if (!dateStr) return '';
const parts = dateStr.split('-');
if (parts.length === 3) {
return `${parts[2]}/${parts[1]}/${parts[0]}`;
}
return dateStr;
};
const filterLabels = {
daily: 'Diário', monthly: 'Mensal', quarterly: 'Trimestral', yearly: 'Anual'
};

return (

```
  {!showPrintView && (
    <div className="print:hidden max-w-5xl mx-auto pb-12 pt-8">
      
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 px-6">
        <div className="flex items-center space-x-3">
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tight">Gestão Financeira</h1>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-widest">Fábio & Marília</h2>
          </div>
        </div>
        
        <div className="flex items-center space-x-4 w-full md:w-auto">
          {statusMsg && (
            <div className="flex-1 md:flex-none flex items-center justify-center text-sm font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-4 py-2">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {statusMsg}
            </div>
          )}
          <button 
            onClick={() => {
              setShowPrintView(true);
              setTimeout(() => window.print(), 500);
            }}
            className="flex-1 md:flex-none flex items-center justify-center font-bold text-black border-2 border-black hover:bg-black hover:text-white px-4 py-2 transition-colors"
          >
            <Printer className="w-4 h-4 md:mr-2" />
            <span className="hidden md:inline">Imprimir Relatório</span>
          </button>
        </div>
      </header>

      <main className="px-6 py-8 space-y-8">
        
        {errorMsg && (
          <div className="bg-black border-4 border-red-600 p-6 flex flex-col text-white print:hidden">
            <div className="flex items-start mb-4">
              <AlertCircle className="w-8 h-8 text-red-500 mr-4 flex-shrink-0" />
              <div>
                <h3 className="font-black text-xl text-red-500 uppercase tracking-widest">Falha de Processamento</h3>
                <p className="text-sm font-bold text-gray-300">{errorMsg}</p>
              </div>
              <button onClick={() => { setErrorMsg(''); setDebugRawText(''); }} className="ml-auto text-gray-400 hover:text-white">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            {debugRawText && (
              <div className="mt-4 bg-gray-900 border border-gray-700 p-4 rounded-sm">
                <p className="text-xs font-bold text-emerald-500 uppercase tracking-widest mb-2">Dados Brutos Retornados pela IA (Debug):</p>
                <pre className="text-xs text-gray-300 whitespace-pre-wrap break-words font-mono overflow-auto max-h-40">
                  {debugRawText}
                </pre>
              </div>
            )}
          </div>
        )}

        <section className="flex flex-col md:flex-row items-center justify-between bg-gray-50 p-4 border border-gray-200 gap-4">
          <div className="flex items-center font-bold uppercase tracking-wider text-sm">
            <Filter className="w-4 h-4 mr-2 text-gray-400" />
            Período de Análise
          </div>
          <div className="flex w-full md:w-auto overflow-x-auto gap-2">
            {Object.entries(filterLabels).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTimeFilter(key)}
                className={`flex-1 md:flex-none px-4 py-2 text-sm font-bold uppercase tracking-wider transition-colors border-2 ${
                  timeFilter === key 
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700' 
                    : 'border-transparent text-gray-500 hover:bg-gray-200 hover:text-black'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-black text-white p-8 flex flex-col justify-center relative overflow-hidden border-b-4 border-emerald-500">
            <div className="relative z-10">
              <p className="text-gray-400 font-bold text-xs mb-2 uppercase tracking-widest">
                Total Saídas • {filterLabels[timeFilter]}
              </p>
              <h2 className="text-5xl font-black text-white mb-2">{formatCurrency(totalAmount)}</h2>
              <p className="text-gray-400 text-sm font-medium">{filteredTransactions.length} registros encontrados</p>
            </div>
            <PieChart className="absolute -bottom-8 -right-8 w-40 h-40 text-white opacity-5" />
          </div>

          <div className="bg-white border-2 border-gray-100 p-6 lg:col-span-2">
            <h3 className="font-black uppercase tracking-wider mb-6 flex items-center border-b-2 border-gray-100 pb-4">
              <PieChart className="w-5 h-5 mr-3 text-emerald-500" />
              Resumo por Classes
            </h3>
            
            <div className="space-y-6">
              {categoryTotals.map(cat => (
                <div key={cat.name}>
                  <div className="flex justify-between items-end border-b border-gray-200 pb-1 mb-2">
                    <span className="font-bold uppercase tracking-wider text-sm">{cat.name}</span>
                    <span className="font-black text-sm">{formatCurrency(cat.amount)}</span>
                  </div>
                  <ul className="space-y-1 pl-4 border-l-2 border-emerald-100">
                    {cat.subCategories.map(sub => (
                      <li key={sub.name} className="flex justify-between text-xs font-medium text-gray-500 uppercase tracking-widest">
                        <span>{sub.name}</span>
                        <span>{formatCurrency(sub.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {categoryTotals.length === 0 && (
                <p className="text-gray-400 text-sm font-medium text-center py-4">Nenhum dado para exibir.</p>
              )}
            </div>
          </div>
        </section>

        <section className="bg-emerald-50 border-2 border-emerald-100 p-8 text-center flex flex-col items-center print:hidden">
          <h3 className="text-xl font-black text-emerald-900 uppercase tracking-tight mb-2">Registrar Nova Saída</h3>
          <p className="text-emerald-700 font-medium mb-8 max-w-md">
            Envie um recibo para leitura automática (data da nota detectada ou hora atual), ou digite manualmente.
          </p>
          
          {!showManualForm ? (
            <div className="flex flex-col sm:flex-row w-full justify-center gap-4 max-w-2xl">
              <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
              <input type="file" accept="image/*" capture="environment" className="hidden" ref={cameraInputRef} onChange={handleFileUpload} />

              <button 
                disabled={!!statusMsg}
                onClick={() => cameraInputRef.current?.click()}
                className="flex-1 flex items-center justify-center px-4 py-3 bg-emerald-600 text-white font-bold uppercase tracking-wider hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                <Camera className="w-5 h-5 mr-2" /> Câmera
              </button>
              
              <button 
                disabled={!!statusMsg}
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 flex items-center justify-center px-4 py-3 bg-white text-emerald-900 border-2 border-emerald-600 font-bold uppercase tracking-wider hover:bg-emerald-100 transition-colors disabled:opacity-50"
              >
                <Upload className="w-5 h-5 mr-2" /> Arquivo
              </button>

              <button 
                disabled={!!statusMsg}
                onClick={() => setShowManualForm(true)}
                className="flex-1 flex items-center justify-center px-4 py-3 bg-black text-white font-bold uppercase tracking-wider hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                <FileText className="w-5 h-5 mr-2" /> Digitar
              </button>
            </div>
          ) : (
            <form onSubmit={handleManualSubmit} className="w-full max-w-2xl bg-white border-2 border-black p-6 text-left">
              <div className="flex justify-between items-center mb-6 border-b-2 border-black pb-2">
                <h4 className="font-black uppercase tracking-tight text-lg">Entrada Manual</h4>
                <button type="button" onClick={() => setShowManualForm(false)} className="text-gray-500 hover:text-black">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Classe</label>
                  <input required type="text" placeholder="Ex: Casa, Saúde..." value={manualData.classe} onChange={e => setManualData({...manualData, classe: e.target.value})} className="w-full border-2 border-gray-300 p-2 font-medium focus:border-emerald-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Subclasse</label>
                  <input required type="text" placeholder="Ex: Luz, Remédios..." value={manualData.subclasse} onChange={e => setManualData({...manualData, subclasse: e.target.value})} className="w-full border-2 border-gray-300 p-2 font-medium focus:border-emerald-500 outline-none" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Descrição / Estabelecimento</label>
                  <input required type="text" placeholder="Ex: Supermercado Extra" value={manualData.descricao} onChange={e => setManualData({...manualData, descricao: e.target.value})} className="w-full border-2 border-gray-300 p-2 font-medium focus:border-emerald-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Data da Saída</label>
                  <input required type="date" value={manualData.data} onChange={e => setManualData({...manualData, data: e.target.value})} className="w-full border-2 border-gray-300 p-2 font-medium focus:border-emerald-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Valor (R$)</label>
                  <input required type="number" step="0.01" placeholder="0.00" value={manualData.valor} onChange={e => setManualData({...manualData, valor: e.target.value})} className="w-full border-2 border-gray-300 p-2 font-black text-xl focus:border-emerald-500 outline-none text-emerald-700" />
                </div>
              </div>
              
              <div className="flex gap-4">
                <button type="submit" className="flex-1 bg-black text-white font-bold uppercase tracking-wider py-3 hover:bg-gray-800">
                  Salvar Gasto
                </button>
              </div>
            </form>
          )}
        </section>

        <section>
          <h3 className="text-xl font-black uppercase tracking-tight border-b-2 border-black pb-4 mb-4 flex items-center">
            Saídas
          </h3>
          
          <div className="bg-white border-2 border-gray-100">
            {filteredTransactions.length > 0 ? (
              <ul className="divide-y-2 divide-gray-100">
                {filteredTransactions.map((tx) => (
                  <li 
                    key={tx.id} 
                    className="hover:bg-gray-50 transition-colors cursor-pointer p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 group"
                    onClick={() => {
                      setSelectedTransaction(tx);
                      setIsEditing(false);
                      setEditData({ classe: tx.classe, subclasse: tx.subclasse, descricao: tx.descricao, valor: tx.valor, data: tx.data || '' });
                    }}
                  >
                    <div className="flex items-center gap-5">
                      <div className="w-12 h-12 bg-gray-100 flex items-center justify-center flex-shrink-0 group-hover:bg-emerald-100 group-hover:text-emerald-600 transition-colors text-gray-400">
                         <ImageIcon className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="font-bold text-lg mb-1">{tx.estabelecimento}</p>
                        <div className="flex flex-wrap items-center text-xs font-bold uppercase tracking-wider text-gray-500 gap-3">
                          <span className="bg-gray-200 text-gray-700 px-2 py-1">
                            {tx.classe} <span className="text-gray-400 px-1">/</span> {tx.subclasse}
                          </span>
                          <span className="flex items-center"><Calendar className="w-3 h-3 mr-1"/> {formatDate(tx.data)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="font-black text-xl text-emerald-600">{formatCurrency(tx.valor)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-16 text-center">
                <FileText className="w-12 h-12 text-gray-200 mx-auto mb-4" />
                <h4 className="font-bold text-gray-400 uppercase tracking-widest">Nenhum registro</h4>
              </div>
            )}
          </div>
        </section>
      </main>

      {selectedTransaction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-white w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col md:flex-row relative border-4 border-white shadow-2xl">
            
            <button 
              onClick={() => setSelectedTransaction(null)}
              className="absolute top-4 right-4 z-10 w-10 h-10 flex items-center justify-center bg-black text-white hover:bg-emerald-500 transition-colors"
            >
              <X className="w-6 h-6" />
            </button>

            <div className="w-full md:w-1/2 bg-gray-100 relative min-h-[300px] flex items-center justify-center border-r-2 border-gray-200 p-4">
              {selectedTransaction.imageUrl ? (
                <img src={selectedTransaction.imageUrl} alt="Recibo Original" className="w-full h-full object-contain drop-shadow-md" />
              ) : (
                <div className="text-gray-400 flex flex-col items-center font-bold uppercase tracking-wider">
                  <ImageIcon className="w-12 h-12 mb-2 opacity-50" />
                  <p>Sem Foto</p>
                </div>
              )}
            </div>

            <div className="w-full md:w-1/2 p-8 flex flex-col bg-white overflow-y-auto">
              {isEditing ? (
                <form onSubmit={handleUpdate} className="flex-1 space-y-4">
                  <h3 className="font-black uppercase text-xl mb-4 border-b-2 border-black pb-2 flex items-center">
                    <Edit3 className="w-5 h-5 mr-2" /> Editar Saída
                  </h3>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Classe</label>
                    <input required type="text" value={editData.classe} onChange={e => setEditData({...editData, classe: e.target.value})} className="w-full border-2 border-gray-300 p-2 font-medium focus:border-emerald-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Subclasse</label>
                    <input required type="text" value={editData.subclasse} onChange={e => setEditData({...editData, subclasse: e.target.value})} className="w-full border-2 border-gray-300 p-2 font-medium focus:border-emerald-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Descrição / Estabelecimento</label>
                    <input required type="text" value={editData.descricao} onChange={e => setEditData({...editData, descricao: e.target.value})} className="w-full border-2 border-gray-300 p-2 font-medium focus:border-emerald-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Data</label>
                    <input required type="date" value={editData.data} onChange={e => setEditData({...editData, data: e.target.value})} className="w-full border-2 border-gray-300 p-2 font-medium focus:border-emerald-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Valor (R$)</label>
                    <input required type="number" step="0.01" value={editData.valor} onChange={e => setEditData({...editData, valor: e.target.value})} className="w-full border-2 border-gray-300 p-2 font-black text-xl focus:border-emerald-500 outline-none text-emerald-700" />
                  </div>
                  <div className="flex gap-2 pt-4">
                    <button type="submit" className="flex-1 bg-emerald-600 text-white font-bold uppercase tracking-wider py-3 hover:bg-emerald-700 transition-colors">Salvar</button>
                    <button type="button" onClick={() => setIsEditing(false)} className="flex-1 bg-gray-200 text-black font-bold uppercase tracking-wider py-3 hover:bg-gray-300 transition-colors">Cancelar</button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="mb-8 border-b-2 border-black pb-6">
                    <div className="flex gap-2 mb-4 flex-wrap">
                      <span className="px-3 py-1 bg-black text-white text-xs font-bold uppercase tracking-wider">
                        {selectedTransaction.classe}
                      </span>
                      <span className="px-3 py-1 bg-gray-200 text-black text-xs font-bold uppercase tracking-wider">
                        {selectedTransaction.subclasse}
                      </span>
                    </div>
                    <h2 className="text-3xl font-black uppercase tracking-tight mb-2">{selectedTransaction.estabelecimento}</h2>
                    <p className="font-bold text-gray-500 uppercase tracking-widest text-sm flex items-center">
                      <Calendar className="w-4 h-4 mr-2" />
                      {formatDate(selectedTransaction.data)}
                    </p>
                  </div>

                  <div className="space-y-6 flex-1">
                    <div>
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Descrição Lida</p>
                      <p className="text-black font-medium border-l-4 border-emerald-500 pl-4 py-1">
                        {selectedTransaction.descricao}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Valor</p>
                      <p className="text-5xl font-black text-emerald-600">
                        {formatCurrency(selectedTransaction.valor)}
                      </p>
                    </div>
                  </div>

                  <div className="pt-8 mt-8 border-t-2 border-gray-100 flex flex-col xl:flex-row gap-3">
                    <button 
                      onClick={() => setIsEditing(true)}
                      className="flex-1 flex items-center justify-center px-4 py-3 text-black font-bold uppercase tracking-widest border-2 border-black hover:bg-black hover:text-white transition-colors"
                    >
                      <Edit3 className="w-5 h-5 mr-2" />
                      Editar
                    </button>
                    <button 
                      onClick={() => handleDelete(selectedTransaction.id)}
                      className="flex-1 flex items-center justify-center px-4 py-3 text-red-600 font-bold uppercase tracking-widest border-2 border-red-600 hover:bg-red-600 hover:text-white transition-colors"
                    >
                      <Trash2 className="w-5 h-5 mr-2" />
                      Apagar
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )}

  {(showPrintView || true) && (
    <div className={`${showPrintView ? 'block fixed inset-0 z-[100] bg-white overflow-y-auto' : 'hidden print:block'}`}>
      {showPrintView && (
        <div className="print:hidden flex flex-col sm:flex-row justify-between items-center p-4 bg-gray-100 border-b-2 border-black sticky top-0 z-10 shadow-sm">
          <p className="font-bold uppercase tracking-widest text-emerald-700 text-sm mb-4 sm:mb-0">
            Pressione Ctrl + P (ou Cmd + P) para imprimir
          </p>
          <div className="flex gap-4 w-full sm:w-auto">
            <button onClick={() => window.print()} className="flex-1 sm:flex-none flex justify-center items-center bg-emerald-600 text-white px-6 py-3 font-bold uppercase tracking-wider hover:bg-emerald-700">
              <Printer className="w-4 h-4 mr-2" /> Imprimir
            </button>
            <button onClick={() => setShowPrintView(false)} className="flex-1 sm:flex-none flex justify-center items-center bg-black text-white px-6 py-3 font-bold uppercase tracking-wider hover:bg-gray-800">
              <X className="w-4 h-4 mr-2" /> Fechar
            </button>
          </div>
        </div>
      )}
      
      <div className="bg-white text-black p-8 font-serif max-w-5xl mx-auto">
        <div className="border-b-4 border-black pb-6 mb-8 flex justify-between items-end">
          <div>
            <h1 className="text-4xl font-black mb-1 uppercase tracking-tight">Relatório de Saídas</h1>
            <h2 className="text-xl font-bold uppercase tracking-widest text-gray-600">Gestão Fábio & Marília</h2>
          </div>
          <div className="text-right">
            <p className="font-bold text-lg">Período: {filterLabels[timeFilter]}</p>
            <p className="text-sm font-medium text-gray-500">Data de Emissão: {new Date().toLocaleDateString('pt-BR')}</p>
          </div>
        </div>

        <div className="mb-10 p-6 border-4 border-black flex justify-between items-center">
          <span className="text-2xl font-black uppercase tracking-widest">Total Saídas</span>
          <span className="text-4xl font-black">{formatCurrency(totalAmount)}</span>
        </div>

        <h3 className="text-2xl font-black uppercase tracking-widest border-b-2 border-black pb-2 mb-6">Consolidado por Classes</h3>
        <div className="mb-12 grid grid-cols-2 gap-x-12 gap-y-8">
          {categoryTotals.map(cat => (
            <div key={cat.name} className="break-inside-avoid">
              <div className="flex justify-between items-end border-b border-black pb-1 mb-3">
                <span className="font-bold text-xl uppercase tracking-wider">{cat.name}</span>
                <span className="font-black text-xl">{formatCurrency(cat.amount)}</span>
              </div>
              <ul className="space-y-2">
                {cat.subCategories.map(sub => (
                  <li key={sub.name} className="flex justify-between text-base font-medium">
                    <span className="text-gray-700">:: {sub.name}</span>
                    <span>{formatCurrency(sub.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <h3 className="text-2xl font-black uppercase tracking-widest border-b-2 border-black pb-2 mb-4">Lançamentos Detalhados</h3>
        <table className="w-full text-left text-sm border-collapse border-y-2 border-black">
          <thead>
            <tr className="border-b-2 border-black font-bold uppercase tracking-wider bg-gray-100">
              <th className="py-3 px-2">Data</th>
              <th className="py-3 px-2">Estabelecimento</th>
              <th className="py-3 px-2">Classificação</th>
              <th className="py-3 px-2">Descrição</th>
              <th className="py-3 px-2 text-right">Valor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-300">
            {filteredTransactions.map(tx => (
              <tr key={tx.id}>
                <td className="py-3 px-2 whitespace-nowrap">{formatDate(tx.data)}</td>
                <td className="py-3 px-2 font-bold">{tx.estabelecimento}</td>
                <td className="py-3 px-2 text-gray-700">{tx.classe} - {tx.subclasse}</td>
                <td className="py-3 px-2 text-gray-600 truncate max-w-[200px]">{tx.descricao}</td>
                <td className="py-3 px-2 text-right font-black">{formatCurrency(tx.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {filteredTransactions.length === 0 && (
          <p className="text-center py-12 text-gray-500 font-medium">Nenhuma movimentação registrada no período.</p>
        )}
      </div>
    </div>
  )}

</div>

```

);
}