const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');
const loading = document.getElementById('loading');
const downloadBtn = document.getElementById('downloadBtn');
const error = document.getElementById('error');

fileInput.addEventListener('change', () => {
  uploadBtn.disabled = !fileInput.files.length;
});

uploadBtn.addEventListener('click', async () => {
  error.classList.add('hidden');
  downloadBtn.classList.add('hidden');

  const file = fileInput.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  uploadBtn.disabled = true;
  loading.classList.remove('hidden');

  try {
    const response = await fetch('/api/gerar', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error('Erro ao gerar os arquivos');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);

    downloadBtn.href = url;
    downloadBtn.classList.remove('hidden');
  } catch (err) {
    error.textContent = err.message;
    error.classList.remove('hidden');
  } finally {
    loading.classList.add('hidden');
    uploadBtn.disabled = false;
  }
});
