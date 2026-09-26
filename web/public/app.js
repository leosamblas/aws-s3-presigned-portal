/**
 * S3 Web Manager - Frontend Application
 * Segue boas práticas de desenvolvimento:
 * - Escopo isolado (sem poluição global)
 * - Manipulação de DOM segura (anti-XSS)
 * - Acessibilidade completa (teclado + ARIA)
 * - API nativa HTML5 Dialog
 */

(() => {
  'use strict';

  // =========================================================================
  // ELEMENTOS DO DOM
  // =========================================================================
  const dom = {
    themeToggleBtn: document.getElementById('themeToggleBtn'),
    themeIcon: document.getElementById('themeIcon'),
    themeLabel: document.getElementById('themeLabel'),
    bucketBadge: document.getElementById('bucketBadge'),
    
    btnModeServer: document.getElementById('btnModeServer'),
    btnModePresigned: document.getElementById('btnModePresigned'),
    modeDescription: document.getElementById('modeDescription'),
    
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('fileInput'),
    fileDetails: document.getElementById('fileDetails'),
    uploadBtn: document.getElementById('uploadBtn'),
    progressBar: document.getElementById('progressBar'),
    progressFill: document.getElementById('progressFill'),
    
    refreshBtn: document.getElementById('refreshBtn'),
    fileTable: document.getElementById('fileTable'),
    fileListBody: document.getElementById('fileListBody'),
    emptyState: document.getElementById('emptyState'),
    
    presignedModal: document.getElementById('presignedModal'),
    presignedUrlInput: document.getElementById('presignedUrlInput'),
    copyPresignedBtn: document.getElementById('copyPresignedBtn'),
    openPresignedBtn: document.getElementById('openPresignedBtn'),
    closeModalBtn: document.getElementById('closeModalBtn'),

    toastContainer: document.getElementById('toastContainer')
  };

  // =========================================================================
  // ESTADO DA APLICAÇÃO
  // =========================================================================
  const state = {
    selectedFile: null,
    uploadMode: 'server', // 'server' | 'presigned'
    theme: localStorage.getItem('s3_theme') || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
  };

  // =========================================================================
  // FUNÇÕES UTILITÁRIAS
  // =========================================================================

  /** Formata bytes para unidades legíveis (B, KB, MB, GB) */
  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  /** Formata timestamps ISO para data/hora local */
  function formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  }

  /** Exibe notificação toast acessível com auto-dismiss */
  function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.className = `toast ${isError ? 'toast-error' : 'toast-success'}`;
    toast.setAttribute('role', 'alert');
    toast.textContent = message;

    dom.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      toast.style.transition = 'all 0.2s ease';
      setTimeout(() => toast.remove(), 250);
    }, 4000);
  }

  // =========================================================================
  // TEMA (LIGHT / DARK)
  // =========================================================================

  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('s3_theme', theme);

    if (theme === 'dark') {
      dom.themeIcon.textContent = '☀️';
      dom.themeLabel.textContent = 'Modo Claro';
      dom.themeToggleBtn.setAttribute('aria-label', 'Alternar para modo claro');
    } else {
      dom.themeIcon.textContent = '🌙';
      dom.themeLabel.textContent = 'Modo Escuro';
      dom.themeToggleBtn.setAttribute('aria-label', 'Alternar para modo escuro');
    }
  }

  function toggleTheme() {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
  }

  // =========================================================================
  // CONTROLE DO MODO DE UPLOAD (VERTENTES)
  // =========================================================================

  function setUploadMode(mode) {
    state.uploadMode = mode;
    const isServer = mode === 'server';

    dom.btnModeServer.setAttribute('aria-pressed', isServer ? 'true' : 'false');
    dom.btnModePresigned.setAttribute('aria-pressed', !isServer ? 'true' : 'false');

    if (isServer) {
      dom.modeDescription.style.borderLeftColor = 'var(--primary)';
      dom.modeDescription.innerHTML = 'ℹ️ <strong>Modo Servidor:</strong> O arquivo é enviado para a API Node.js local, que o encaminha com segurança para o bucket S3. Ideal para simplicidade e dispensa CORS.';
      dom.uploadBtn.className = 'btn btn-primary';
      dom.uploadBtn.textContent = 'Enviar via Servidor';
    } else {
      dom.modeDescription.style.borderLeftColor = 'var(--accent)';
      dom.modeDescription.innerHTML = '⚡ <strong>Modo Presigned URL:</strong> O front-end solicita uma URL pré-assinada temporária e faz o upload direto no S3 (sem sobrecarregar o servidor).';
      dom.uploadBtn.className = 'btn btn-purple';
      dom.uploadBtn.textContent = 'Enviar via Presigned URL';
    }
  }

  // =========================================================================
  // SELEÇÃO E MANIPULAÇÃO DE ARQUIVO
  // =========================================================================

  function handleFileSelected(file) {
    if (!file) return;
    state.selectedFile = file;

    dom.fileDetails.textContent = `📄 ${file.name} (${formatBytes(file.size)})`;
    dom.fileDetails.style.display = 'block';
    dom.uploadBtn.disabled = false;
  }

  function resetUploadForm() {
    state.selectedFile = null;
    dom.fileInput.value = '';
    dom.fileDetails.style.display = 'none';
    dom.progressBar.style.display = 'none';
    dom.progressFill.style.width = '0%';
    dom.uploadBtn.disabled = true;
    dom.uploadBtn.textContent = state.uploadMode === 'server' ? 'Enviar via Servidor' : 'Enviar via Presigned URL';
  }

  // =========================================================================
  // EXECUÇÃO DO UPLOAD
  // =========================================================================

  async function handleUpload() {
    if (!state.selectedFile) return;

    dom.uploadBtn.disabled = true;

    if (state.uploadMode === 'server') {
      await uploadViaServer();
    } else {
      await uploadViaPresigned();
    }
  }

  /** Vertente 1: Upload via Servidor Local (Proxy) */
  async function uploadViaServer() {
    dom.uploadBtn.textContent = 'Enviando ao servidor...';

    const formData = new FormData();
    formData.append('file', state.selectedFile);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (response.ok) {
        showToast(`✅ [Servidor] Arquivo "${state.selectedFile.name}" enviado com sucesso!`);
        resetUploadForm();
        loadBucketFiles();
      } else {
        showToast(data.error || 'Falha no upload via servidor.', true);
        dom.uploadBtn.disabled = false;
        dom.uploadBtn.textContent = 'Enviar via Servidor';
      }
    } catch (err) {
      showToast('Erro de comunicação ao enviar arquivo.', true);
      dom.uploadBtn.disabled = false;
      dom.uploadBtn.textContent = 'Enviar via Servidor';
    }
  }

  /** Vertente 2: Upload via Presigned URL (Direto S3) */
  async function uploadViaPresigned() {
    dom.uploadBtn.textContent = 'Gerando link presigned...';

    try {
      // 1. Pede a URL assinada ao backend
      const presignRes = await fetch('/api/presigned/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: state.selectedFile.name,
          contentType: state.selectedFile.type || 'application/octet-stream'
        })
      });

      const presignData = await presignRes.json();
      if (!presignRes.ok) {
        showToast(presignData.error || 'Erro ao gerar URL pré-assinada', true);
        dom.uploadBtn.disabled = false;
        dom.uploadBtn.textContent = 'Enviar via Presigned URL';
        return;
      }

      dom.uploadBtn.textContent = 'Enviando direto ao S3...';
      dom.progressBar.style.display = 'block';
      dom.progressFill.style.width = '0%';

      // 2. Faz PUT direto para a AWS
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', presignData.url, true);
      xhr.setRequestHeader('Content-Type', state.selectedFile.type || 'application/octet-stream');

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          dom.progressFill.style.width = `${percent}%`;
        }
      };

      xhr.onload = () => {
        dom.progressBar.style.display = 'none';
        if (xhr.status >= 200 && xhr.status < 300) {
          showToast(`⚡ [Presigned URL] Upload concluído direto no S3!`);
          resetUploadForm();
          loadBucketFiles();
        } else {
          showToast(`Erro S3 (${xhr.status}). Verifique as permissões de CORS.`, true);
          dom.uploadBtn.disabled = false;
          dom.uploadBtn.textContent = 'Enviar via Presigned URL';
        }
      };

      xhr.onerror = () => {
        dom.progressBar.style.display = 'none';
        showToast('Falha de rede ou bloqueio de CORS ao contatar o S3.', true);
        dom.uploadBtn.disabled = false;
        dom.uploadBtn.textContent = 'Enviar via Presigned URL';
      };

      xhr.send(state.selectedFile);

    } catch (err) {
      showToast('Falha ao processar upload presigned.', true);
      dom.uploadBtn.disabled = false;
      dom.uploadBtn.textContent = 'Enviar via Presigned URL';
    }
  }

  // =========================================================================
  // LISTAGEM DE ARQUIVOS (RENDERIZAÇÃO SEGURA ANTI-XSS)
  // =========================================================================

  async function loadBucketFiles() {
    try {
      const response = await fetch('/api/files');
      const data = await response.json();

      if (!response.ok) {
        showToast(data.error || 'Erro ao listar arquivos do bucket.', true);
        return;
      }

      dom.bucketBadge.textContent = `📦 Bucket: ${data.bucket}`;
      dom.fileListBody.innerHTML = '';

      if (!data.files || data.files.length === 0) {
        dom.emptyState.style.display = 'block';
        dom.fileTable.style.display = 'none';
        return;
      }

      dom.emptyState.style.display = 'none';
      dom.fileTable.style.display = 'table';

      // Criação de elementos DOM seguros usando createElement e textContent (sem XSS)
      data.files.forEach((file) => {
        const tr = document.createElement('tr');

        // Coluna 1: Nome
        const tdName = document.createElement('td');
        const nameCell = document.createElement('div');
        nameCell.className = 'file-name-cell';
        const iconSpan = document.createElement('span');
        iconSpan.textContent = '📄';
        const nameStrong = document.createElement('strong');
        nameStrong.textContent = file.key;
        nameCell.append(iconSpan, nameStrong);
        tdName.appendChild(nameCell);

        // Coluna 2: Tamanho
        const tdSize = document.createElement('td');
        tdSize.textContent = formatBytes(file.size);

        // Coluna 3: Data
        const tdDate = document.createElement('td');
        tdDate.textContent = formatDate(file.lastModified);

        // Coluna 4: Ações
        const tdActions = document.createElement('td');
        tdActions.style.textAlign = 'right';

        // Botão Baixar via Servidor
        const btnDownload = document.createElement('a');
        btnDownload.className = 'btn btn-sm btn-download';
        btnDownload.href = `/api/download/${encodeURIComponent(file.key)}`;
        btnDownload.title = 'Baixar através da API local';
        btnDownload.textContent = '💻 Baixar';
        btnDownload.style.marginRight = '4px';

        // Botão Gerar Presigned Link
        const btnPresigned = document.createElement('button');
        btnPresigned.className = 'btn btn-sm btn-presigned';
        btnPresigned.type = 'button';
        btnPresigned.title = 'Gerar link temporário direto do S3';
        btnPresigned.textContent = '⚡ Presigned';
        btnPresigned.style.marginRight = '4px';
        btnPresigned.addEventListener('click', () => openPresignedModal(file.key));

        // Botão Excluir
        const btnDelete = document.createElement('button');
        btnDelete.className = 'btn btn-sm btn-delete';
        btnDelete.type = 'button';
        btnDelete.title = 'Remover arquivo do bucket';
        btnDelete.textContent = '🗑️';
        btnDelete.addEventListener('click', () => deleteFile(file.key));

        tdActions.append(btnDownload, btnPresigned, btnDelete);
        tr.append(tdName, tdSize, tdDate, tdActions);
        dom.fileListBody.appendChild(tr);
      });

    } catch (err) {
      showToast('Não foi possível conectar ao servidor backend.', true);
    }
  }

  // =========================================================================
  // MODAL DE PRESIGNED URL (HTML5 DIALOG)
  // =========================================================================

  async function openPresignedModal(key) {
    try {
      const response = await fetch(`/api/presigned/download/${encodeURIComponent(key)}`);
      const data = await response.json();

      if (response.ok) {
        dom.presignedUrlInput.value = data.url;
        if (typeof dom.presignedModal.showModal === 'function') {
          dom.presignedModal.showModal();
        } else {
          dom.presignedModal.setAttribute('open', '');
        }
      } else {
        showToast(data.error || 'Erro ao gerar presigned URL.', true);
      }
    } catch (err) {
      showToast('Erro ao contatar o endpoint de Presigned URL.', true);
    }
  }

  function closePresignedModal() {
    if (typeof dom.presignedModal.close === 'function') {
      dom.presignedModal.close();
    } else {
      dom.presignedModal.removeAttribute('open');
    }
  }

  async function copyPresignedLink() {
    try {
      await navigator.clipboard.writeText(dom.presignedUrlInput.value);
      showToast('📋 Link copiado para a área de transferência!');
    } catch (err) {
      dom.presignedUrlInput.select();
      document.execCommand('copy');
      showToast('📋 Link copiado!');
    }
  }

  function openPresignedDownload() {
    window.open(dom.presignedUrlInput.value, '_blank', 'noopener,noreferrer');
    closePresignedModal();
  }

  // =========================================================================
  // DELEÇÃO DE ARQUIVO
  // =========================================================================

  async function deleteFile(key) {
    if (!window.confirm(`Tem certeza que deseja remover o arquivo "${key}" do bucket?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/files/${encodeURIComponent(key)}`, {
        method: 'DELETE'
      });
      const data = await response.json();

      if (response.ok) {
        showToast(`Arquivo "${key}" removido com sucesso!`);
        loadBucketFiles();
      } else {
        showToast(data.error || 'Erro ao remover arquivo.', true);
      }
    } catch (err) {
      showToast('Falha de conexão ao tentar remover arquivo.', true);
    }
  }

  // =========================================================================
  // EVENT LISTENERS & INICIALIZAÇÃO
  // =========================================================================

  function setupEvents() {
    // Tema
    dom.themeToggleBtn.addEventListener('click', toggleTheme);

    // Modos de upload
    dom.btnModeServer.addEventListener('click', () => setUploadMode('server'));
    dom.btnModePresigned.addEventListener('click', () => setUploadMode('presigned'));

    // Input de arquivo
    dom.fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleFileSelected(e.target.files[0]);
      }
    });

    // Dropzone (Clique + Teclado + Drag & Drop)
    dom.dropzone.addEventListener('click', () => dom.fileInput.click());
    dom.dropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        dom.fileInput.click();
      }
    });

    ['dragenter', 'dragover'].forEach(name => {
      dom.dropzone.addEventListener(name, (e) => {
        e.preventDefault();
        dom.dropzone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(name => {
      dom.dropzone.addEventListener(name, (e) => {
        e.preventDefault();
        dom.dropzone.classList.remove('dragover');
      });
    });

    dom.dropzone.addEventListener('drop', (e) => {
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        dom.fileInput.files = e.dataTransfer.files;
        handleFileSelected(e.dataTransfer.files[0]);
      }
    });

    // Botão de upload
    dom.uploadBtn.addEventListener('click', handleUpload);

    // Atualização da lista
    dom.refreshBtn.addEventListener('click', loadBucketFiles);

    // Modal
    dom.closeModalBtn.addEventListener('click', closePresignedModal);
    dom.copyPresignedBtn.addEventListener('click', copyPresignedLink);
    dom.openPresignedBtn.addEventListener('click', openPresignedDownload);

    // Fecha o modal clicando fora (backdrop)
    dom.presignedModal.addEventListener('click', (e) => {
      if (e.target === dom.presignedModal) {
        closePresignedModal();
      }
    });
  }

  // Inicialização
  applyTheme(state.theme);
  setupEvents();
  loadBucketFiles();

})();
