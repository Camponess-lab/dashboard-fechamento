/**
 * =============================================================================
 *  SISTEMA DE FECHAMENTO GERENCIAL — Backend (Google Apps Script)
 * =============================================================================
 *  Responsabilidades deste arquivo:
 *    • Autenticação simples (checkLogin)
 *    • Servir a interface HTML (doGet / include)
 *    • Persistir e ler fechamentos numa planilha do Google Sheets
 *
 *  A interface (arquivo "index") chama as funções públicas abaixo via
 *  google.script.run. Os NOMES das funções públicas não devem ser alterados
 *  sem ajustar também o front-end.
 * =============================================================================
 */

// ----------------------------------------------------------------------------
// Configuração
// ----------------------------------------------------------------------------
const APP_NAME            = 'Sistema de Fechamento Gerencial';
const SPREADSHEET_NAME    = 'Base - Sistema Fechamento Gerencial NOVA 2026-06-29';
const SHEET_NAME          = 'FECHAMENTOS';
const AUDIT_SHEET_NAME    = 'AUDITORIA';
const PROP_SPREADSHEET_ID = 'FECHAMENTO_SPREADSHEET_ID_NOVA_20260629';
const BACKEND_VERSION     = '2026-06-29.3-nova-base';
// Planilha nova criada do zero para esta instalação limpa.
const MANUAL_SPREADSHEET_ID = '1wXdjDn_ymDX0xK2v-30HEACmW-plvvWwc7QiTjyYbtw';
const DEFAULT_LIST_LIMIT  = 20;
const MAX_LIST_LIMIT      = 100;
const JSON_CELL_MAX_LENGTH = 45000;
const AUTH_REQUIRED_FOR_FECHAMENTOS = true;
const ALLOW_IFRAME_EMBEDDING = false;
const LOGIN_USER_PATTERN  = /^[a-z0-9._-]{3,40}$/;
const INCLUDE_FILE_PATTERN = /^[A-Za-z0-9_-]{1,60}$/;

// Colunas da planilha, na ordem em que são gravadas/lidas.
const SHEET_HEADERS = [
  'ID', 'Criado em', 'Atualizado em', 'Usuário', 'Data', 'Turno', 'Título',
  'ABS T1', 'DOT T1', 'OOT T1', 'DOT Dia', 'OOT Dia', 'DOT Semana',
  'DOT médio HH', 'Total PCTS', 'Total perdas lidas', 'Hora crítica',
  'Status resumo', 'JSON completo'
];

const AUDIT_HEADERS = [
  'Data/Hora', 'Evento', 'Usuário', 'Detalhes'
];

// ----------------------------------------------------------------------------
// Autenticação
// ----------------------------------------------------------------------------
// As senhas NÃO ficam em texto aberto no HTML nem no Code.gs.
// O sistema usa SHA-256 com salt e armazena os usuários no PropertiesService.
// Todos os usuários iniciais entram com senha provisória e precisam trocar no primeiro acesso.
const LOGIN_USERS_PROPERTY        = 'FECHAMENTO_LOGIN_USERS_NOVA_20260629_V1';
const LEGACY_LOGIN_USERS_PROPERTY = 'FECHAMENTO_LOGIN_USERS_NOVA_LEGACY';
const OLD_LOGIN_USERS_PROPERTY    = 'FECHAMENTO_LOGIN_USERS_NOVA_OLD';
const LOGIN_TOKEN_PREFIX          = 'FECHAMENTO_LOGIN_TOKEN_NOVA_20260629_';
const LOGIN_TOKEN_TTL_SECONDS     = 21600; // 6 horas
const LOGIN_THROTTLE_PREFIX       = 'FECHAMENTO_LOGIN_THROTTLE_NOVA_20260629_';
const LOGIN_MAX_FAILED_ATTEMPTS   = 7;
const LOGIN_LOCKOUT_SECONDS       = 900; // 15 minutos
const LOGIN_ATTEMPT_WINDOW_SECONDS = 900; // 15 minutos
const MIN_PASSWORD_LENGTH         = 8;
const PASSWORD_HISTORY_LIMIT      = 3;
const PASSWORD_RESET_REQUESTS_PROPERTY = 'FECHAMENTO_PASSWORD_RESET_REQUESTS_NOVA_20260629_V1';
const COMMON_WEAK_PASSWORDS = [
  '12345678', '123456789', 'senha123', 'senha1234', 'password1',
  'qwerty123', 'admin123', 'fechamento', 'fechamento123'
];

// A base de usuários NÃO fica no código-fonte (sem PII nem hashes versionados).
// Os logins ficam no PropertiesService (LOGIN_USERS_PROPERTY); o PRIMEIRO
// administrador é criado uma única vez via setupPrimeiroAdmin() / seedInitialAdmin()
// executado no editor do Apps Script (salt aleatório, troca obrigatória no 1º acesso).
// Mantido vazio por compatibilidade com getLoginUsers_ / getLoginBackendStatus.
const DEFAULT_LOGIN_USERS_SERVER = [];

/**
 * Executa gravacoes criticas com lock para reduzir risco de sobrescrita
 * quando dois usuarios salvam ou administram contas ao mesmo tempo.
 */
function withScriptLock_(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

/**
 * BOOTSTRAP — cria (ou reativa) o primeiro administrador SEM expor credenciais
 * no código-fonte. Gera salt aleatório e marca troca obrigatória no 1º acesso.
 * Reutilizável também para recuperar acesso de administrador.
 */
function seedInitialAdmin(nome, usuario, senhaProvisoria) {
  nome = String(nome || '').trim();
  const login = normalizeLogin_(usuario);
  const senha = String(senhaProvisoria || '');
  if (!nome) throw new Error('Informe o nome do administrador.');
  if (!login) throw new Error('Informe o login do administrador.');
  if (!LOGIN_USER_PATTERN.test(login)) {
    throw new Error('O login deve ter de 3 a 40 caracteres e usar apenas letras, números, ponto, hífen ou sublinhado.');
  }

  return withScriptLock_(function() {
    let users = getLoginUsers_();
    const validationMessage = validatePasswordStrength_(login, senha, '', null);
    if (validationMessage) throw new Error(validationMessage);

    let user = users.find(function(item) { return normalizeLogin_(item.usuario) === login; });
    const isNew = !user;
    if (isNew) {
      user = cleanLoginUser_({ nome: nome, usuario: login, perfil: 'admin', ativo: true });
      users.push(user);
    } else {
      user.nome = nome;
      user.perfil = 'admin';
      user.ativo = true;
    }
    setUserPassword_(user, senha, true);
    users = saveLoginUsers_(users);
    auditLog_(null, isNew ? 'ADMIN_INICIAL_CRIADO' : 'ADMIN_INICIAL_ATUALIZADO', 'manual', 'Administrador definido via bootstrap: ' + login + '.');
    return getLoginUsers_().map(publicLoginUser_);
  });
}

/**
 * Atalho para rodar no editor do Apps Script: preencha as três constantes,
 * execute UMA vez e depois apague os valores. Cria o primeiro administrador.
 */
function setupPrimeiroAdmin() {
  const NOME = '';              // ex.: 'NOME SOBRENOME'
  const LOGIN = '';             // ex.: 'nsobrenome'
  const SENHA_PROVISORIA = '';  // mín. 8 caracteres, com letras e números
  return seedInitialAdmin(NOME, LOGIN, SENHA_PROVISORIA);
}

function normalizePasswordHistory_(history) {
  if (!Array.isArray(history)) return [];
  return history.map(function(item) {
    item = item || {};
    return {
      senhaSalt: String(item.senhaSalt || item.salt || '').trim(),
      senhaHash: String(item.senhaHash || item.hash || '').trim().toLowerCase(),
      changedAt: String(item.changedAt || item.passwordChangedAt || '').trim()
    };
  }).filter(function(item) {
    return item.senhaHash;
  }).slice(0, PASSWORD_HISTORY_LIMIT);
}

function currentPasswordCredential_(user) {
  user = user || {};
  const hash = String(user.senhaHash || user.hash || '').trim().toLowerCase();
  if (!hash) return null;
  return {
    senhaSalt: String(user.senhaSalt || user.salt || '').trim(),
    senhaHash: hash,
    changedAt: String(user.passwordChangedAt || user.passwordResetAt || new Date().toISOString())
  };
}

function rememberCurrentPassword_(user) {
  const current = currentPasswordCredential_(user);
  const history = normalizePasswordHistory_(user.passwordHistory);
  if (!current) return history;

  const sameAlreadyStored = history.some(function(item) {
    return item.senhaHash === current.senhaHash && item.senhaSalt === current.senhaSalt;
  });
  if (!sameAlreadyStored) history.unshift(current);
  return history.slice(0, PASSWORD_HISTORY_LIMIT);
}

function normalizeLogin_(value) {
  let text = String(value || '').trim().toLowerCase();
  // Remove acentos para evitar diferenca entre login digitado com/sem acentuacao.
  try {
    text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch (err) {
    // Mantem compatibilidade caso normalize nao esteja disponivel.
  }
  return text;
}

function sha256Hex_(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ''),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function(byte) {
    const v = byte < 0 ? byte + 256 : byte;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}

function passwordHash_(password, salt) {
  const base = String(salt || '') ? String(salt || '') + '::' + String(password || '') : String(password || '');
  return sha256Hex_(base);
}

function newPasswordSalt_() {
  return Utilities.getUuid().replace(/-/g, '') + String(new Date().getTime());
}

function setUserPassword_(user, password, mustChange) {
  user.passwordHistory = rememberCurrentPassword_(user);
  const salt = newPasswordSalt_();
  user.senhaSalt = salt;
  user.senhaHash = passwordHash_(password, salt);
  user.mustChangePassword = !!mustChange;
  if (mustChange) {
    user.passwordResetAt = new Date().toISOString();
    user.passwordChangedAt = '';
  } else {
    user.passwordChangedAt = new Date().toISOString();
    user.passwordResetAt = String(user.passwordResetAt || '');
  }
  return user;
}

function checkPasswordHistory_(user, password) {
  const pass = String(password || '');
  return normalizePasswordHistory_(user && user.passwordHistory).some(function(item) {
    if (!item.senhaHash) return false;
    return passwordHash_(pass, item.senhaSalt) === item.senhaHash;
  });
}

function validatePasswordStrength_(login, password, currentPassword, user) {
  const pass = String(password || '');
  const normalizedLogin = normalizeLogin_(login);
  const normalizedPass = normalizeLogin_(pass);

  if (pass.length < MIN_PASSWORD_LENGTH) {
    return 'A senha precisa ter pelo menos ' + MIN_PASSWORD_LENGTH + ' caracteres.';
  }
  if (String(currentPassword || '') && pass === String(currentPassword || '')) {
    return 'A nova senha deve ser diferente da senha atual.';
  }
  if (normalizedLogin && (normalizedPass === normalizedLogin || normalizedPass.indexOf(normalizedLogin) >= 0)) {
    return 'A senha não deve conter o login do usuário.';
  }
  if (COMMON_WEAK_PASSWORDS.indexOf(normalizedPass) >= 0) {
    return 'Use uma senha menos previsível.';
  }
  if (!/[A-Za-z]/.test(pass) || !/\d/.test(pass)) {
    return 'A senha precisa combinar letras e números.';
  }
  if (/^(.)\1+$/.test(pass)) {
    return 'A senha não pode repetir o mesmo caractere.';
  }
  if (user && checkUserPassword_(user, pass)) {
    return 'A nova senha deve ser diferente da senha atual.';
  }
  if (user && checkPasswordHistory_(user, pass)) {
    return 'A nova senha não pode repetir uma das senhas recentes.';
  }
  return '';
}

function checkUserPassword_(user, password) {
  const pass = String(password || '');
  const storedHash = String(user.senhaHash || user.hash || '').trim().toLowerCase();
  const salt = String(user.senhaSalt || user.salt || '').trim();
  if (!storedHash) return false;
  if (salt) return passwordHash_(pass, salt) === storedHash;
  // Compatibilidade com usuários antigos que ainda estavam sem salt.
  return passwordHash_(pass, '') === storedHash;
}

function cleanLoginUser_(user) {
  user = user || {};
  const usuario = normalizeLogin_(user.usuario || user.user || user.login);
  const legacyPlainPassword = String(user.senha || '').trim();
  let senhaSalt = String(user.senhaSalt || user.salt || '').trim();
  let senhaHash = String(user.senhaHash || user.hash || '').trim().toLowerCase();
  if (legacyPlainPassword) {
    senhaSalt = senhaSalt || newPasswordSalt_();
    senhaHash = passwordHash_(legacyPlainPassword, senhaSalt);
  }
  return {
    nome: String(user.nome || user.name || usuario || '').trim(),
    usuario: usuario,
    senhaSalt: senhaSalt,
    senhaHash: senhaHash,
    perfil: normalizeLogin_(user.perfil || user.role || 'operador') === 'admin' ? 'admin' : 'operador',
    ativo: user.ativo !== false,
    mustChangePassword: !!(user.mustChangePassword || user.trocarSenha || user.forceChangePassword || user.primeiroAcesso),
    passwordChangedAt: String(user.passwordChangedAt || '').trim(),
    passwordResetAt: String(user.passwordResetAt || '').trim(),
    passwordHistory: normalizePasswordHistory_(user.passwordHistory || user.senhasAnteriores)
  };
}

function parseLoginUsersFromProperty_(propName) {
  const raw = PropertiesService.getScriptProperties().getProperty(propName);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(cleanLoginUser_).filter(function(user) {
      return user.usuario && user.nome && user.senhaHash;
    }) : [];
  } catch (err) {
    return [];
  }
}

function getLoginUsers_() {
  const props = PropertiesService.getScriptProperties();
  let users = parseLoginUsersFromProperty_(LOGIN_USERS_PROPERTY);
  const defaultUsers = DEFAULT_LOGIN_USERS_SERVER.map(cleanLoginUser_);

  // Esta versão inicia uma nova base segura de usuários. Propriedades antigas são limpas
  // para evitar senhas antigas ou cadastros locais incorretos.
  if (!users.length) {
    users = defaultUsers;
    props.setProperty(LOGIN_USERS_PROPERTY, JSON.stringify(users));
    props.deleteProperty(LEGACY_LOGIN_USERS_PROPERTY);
    props.deleteProperty(OLD_LOGIN_USERS_PROPERTY);
    return users;
  }

  // Quando novos logins padrão forem adicionados ao código, eles entram na base
  // sem resetar senhas que usuários antigos já trocaram no primeiro acesso.
  const defaultMap = {};
  defaultUsers.forEach(function(defaultUser) {
    defaultMap[normalizeLogin_(defaultUser.usuario)] = defaultUser;
  });

  const existing = {};
  let changed = false;

  users = users.map(function(user) {
    const clean = cleanLoginUser_(user);
    const key = normalizeLogin_(clean.usuario);
    existing[key] = true;

    // Se o usuário ainda está em primeiro acesso e nunca trocou a senha,
    // garante que a senha provisória padrão atual esteja aplicada.
    if (defaultMap[key] && clean.mustChangePassword && !clean.passwordChangedAt) {
      if (clean.senhaHash !== defaultMap[key].senhaHash || clean.senhaSalt !== defaultMap[key].senhaSalt) {
        const refreshed = cleanLoginUser_(Object.assign({}, clean, {
          senhaSalt: defaultMap[key].senhaSalt,
          senhaHash: defaultMap[key].senhaHash,
          mustChangePassword: true
        }));
        refreshed.passwordResetAt = clean.passwordResetAt || new Date().toISOString();
        changed = true;
        return refreshed;
      }
    }

    return clean;
  });

  defaultUsers.forEach(function(defaultUser) {
    const key = normalizeLogin_(defaultUser.usuario);
    if (key && !existing[key]) {
      users.push(defaultUser);
      existing[key] = true;
      changed = true;
    }
  });

  if (changed) {
    props.setProperty(LOGIN_USERS_PROPERTY, JSON.stringify(users));
  }

  return users;
}

function saveLoginUsers_(users) {
  const clean = (Array.isArray(users) ? users : [])
    .map(cleanLoginUser_)
    .filter(function(user) {
      return user.nome && user.usuario && user.senhaHash;
    });

  const seen = {};
  clean.forEach(function(user) {
    const key = normalizeLogin_(user.usuario);
    if (seen[key]) {
      throw new Error('Existe login duplicado na base de usuários: ' + key);
    }
    seen[key] = true;
  });

  if (!clean.some(isActiveAdmin_)) {
    throw new Error('É obrigatório manter pelo menos um administrador ativo.');
  }

  clean.sort(function(a, b) {
    return String(a.nome || a.usuario).localeCompare(String(b.nome || b.usuario), 'pt-BR');
  });

  PropertiesService.getScriptProperties().setProperty(LOGIN_USERS_PROPERTY, JSON.stringify(clean));
  return clean;
}

function publicLoginUser_(user) {
  user = cleanLoginUser_(user);
  return {
    nome: user.nome,
    usuario: user.usuario,
    perfil: user.perfil || 'operador',
    ativo: user.ativo !== false,
    mustChangePassword: !!user.mustChangePassword,
    senhaCadastrada: !!user.senhaHash,
    passwordResetAt: user.passwordResetAt || '',
    passwordChangedAt: user.passwordChangedAt || ''
  };
}

function createLoginToken_(usuario) {
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put(LOGIN_TOKEN_PREFIX + token, normalizeLogin_(usuario), LOGIN_TOKEN_TTL_SECONDS);
  return token;
}

function loginThrottleKey_(usuario) {
  return LOGIN_THROTTLE_PREFIX + sha256Hex_(normalizeLogin_(usuario)).slice(0, 48);
}

function getLoginThrottle_(usuario) {
  const raw = CacheService.getScriptCache().get(loginThrottleKey_(usuario));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function getLoginBlockedMessage_(usuario) {
  const state = getLoginThrottle_(usuario);
  if (!state || !state.lockedUntil) return '';

  const remainingMs = Number(state.lockedUntil) - new Date().getTime();
  if (remainingMs <= 0) return '';

  const minutes = Math.max(1, Math.ceil(remainingMs / 60000));
  return 'Muitas tentativas incorretas. Aguarde ' + minutes + ' minuto(s) e tente novamente.';
}

function registerFailedLogin_(usuario) {
  const cache = CacheService.getScriptCache();
  const key = loginThrottleKey_(usuario);
  const now = new Date().getTime();
  const windowMs = LOGIN_ATTEMPT_WINDOW_SECONDS * 1000;
  const lockoutMs = LOGIN_LOCKOUT_SECONDS * 1000;
  const state = getLoginThrottle_(usuario) || {};
  const firstAt = state.firstAt && (now - Number(state.firstAt) <= windowMs) ? Number(state.firstAt) : now;
  const attempts = firstAt === Number(state.firstAt) ? Number(state.attempts || 0) + 1 : 1;
  const nextState = {
    firstAt: firstAt,
    attempts: attempts,
    lockedUntil: attempts >= LOGIN_MAX_FAILED_ATTEMPTS ? now + lockoutMs : 0
  };

  cache.put(key, JSON.stringify(nextState), Math.max(LOGIN_ATTEMPT_WINDOW_SECONDS, LOGIN_LOCKOUT_SECONDS));
  return nextState;
}

function clearFailedLogin_(usuario) {
  CacheService.getScriptCache().remove(loginThrottleKey_(usuario));
}

function extractAuthToken_(auth) {
  if (!auth) return '';
  if (typeof auth === 'object') {
    return String(auth.token || auth.authToken || auth.sessionToken || auth.loginToken || '').trim();
  }
  return String(auth || '').trim();
}

function usuarioFromAuth_(auth) {
  const value = extractAuthToken_(auth);
  if (!value) return '';

  const tokenUser = CacheService.getScriptCache().get(LOGIN_TOKEN_PREFIX + value);
  // A administracao de usuarios exige token de sessao gerado pelo login.
  // Nao aceite o login puro como autenticacao, pois o front-end pode ser inspecionado pelo navegador.
  return tokenUser ? normalizeLogin_(tokenUser) : '';
}

function getSessionUser_(auth) {
  const usuario = usuarioFromAuth_(auth);
  if (!usuario) return null;
  return getLoginUsers_().find(function(user) {
    return user.ativo !== false && normalizeLogin_(user.usuario) === usuario;
  }) || null;
}

function isActiveAdmin_(user) {
  return !!(user && user.ativo !== false && normalizeLogin_(user.perfil) === 'admin');
}

function requireValidSessionIfProvided_(auth) {
  if (!extractAuthToken_(auth)) return null;
  const user = getSessionUser_(auth);
  if (!user) {
    throw new Error('Sessão expirada: faça login novamente.');
  }
  return user;
}

function requireSession_(auth) {
  const user = getSessionUser_(auth);
  if (!user) {
    throw new Error('Sessão expirada: faça login novamente.');
  }
  return user;
}

function requireAdmin_(auth) {
  const admin = getSessionUser_(auth);
  if (!isActiveAdmin_(admin)) {
    throw new Error('Acesso negado ou sessão expirada: faça login novamente com um usuário administrador.');
  }
  return admin;
}

function loginResponse_(user) {
  return {
    ok: true,
    success: true,
    usuario: user.usuario,
    nome: user.nome || user.usuario,
    perfil: user.perfil || 'operador',
    token: createLoginToken_(user.usuario),
    source: 'apps-script',
    backendVersion: BACKEND_VERSION,
    message: 'Login realizado com sucesso.'
  };
}

function checkLogin(usuario, senha) {
  const user = normalizeLogin_(usuario);
  const pass = String(senha || '');

  if (!user || !pass) {
    return { ok: false, success: false, message: 'Informe usuário e senha.' };
  }

  const blockedMessage = getLoginBlockedMessage_(user);
  if (blockedMessage) {
    return { ok: false, success: false, locked: true, message: blockedMessage };
  }

  const found = getLoginUsers_().find(function(item) {
    return item.ativo !== false &&
      normalizeLogin_(item.usuario) === user &&
      checkUserPassword_(item, pass);
  });

  if (!found) {
    registerFailedLogin_(user);
    return { ok: false, success: false, message: 'Usuário ou senha inválidos.' };
  }

  clearFailedLogin_(user);

  if (found.mustChangePassword) {
    return {
      ok: true,
      success: true,
      requiresPasswordChange: true,
      mustChangePassword: true,
      usuario: found.usuario,
      nome: found.nome || found.usuario,
      perfil: found.perfil || 'operador',
      source: 'apps-script',
      backendVersion: BACKEND_VERSION,
      message: 'Altere a senha para concluir o primeiro acesso.'
    };
  }

  return loginResponse_(found);
}

function validateSession(auth) {
  const user = getSessionUser_(auth);
  if (!user) {
    return { ok: false, success: false, message: 'Sessão expirada. Faça login novamente.' };
  }
  return { ok: true, success: true, user: publicLoginUser_(user), backendVersion: BACKEND_VERSION };
}

function logout(auth) {
  const token = extractAuthToken_(auth);
  if (token) CacheService.getScriptCache().remove(LOGIN_TOKEN_PREFIX + token);
  return { ok: true, success: true, message: 'Sessão encerrada.' };
}

function changeOwnPassword(usuario, senhaAtual, novaSenha) {
  const login = normalizeLogin_(usuario);
  const current = String(senhaAtual || '');
  const next = String(novaSenha || '');

  if (!login || !current || !next) {
    return { ok: false, success: false, message: 'Informe usuário, senha atual e nova senha.' };
  }

  const blockedMessage = getLoginBlockedMessage_(login);
  if (blockedMessage) {
    return { ok: false, success: false, locked: true, message: blockedMessage };
  }

  return withScriptLock_(function() {
    let users = getLoginUsers_();
    const index = users.findIndex(function(item) {
      return item.ativo !== false && normalizeLogin_(item.usuario) === login && checkUserPassword_(item, current);
    });

    if (index < 0) {
      registerFailedLogin_(login);
      return { ok: false, success: false, message: 'Usuario ou senha atual invalidos.' };
    }

    const validationMessage = validatePasswordStrength_(login, next, current, users[index]);
    if (validationMessage) {
      return { ok: false, success: false, message: validationMessage };
    }

    clearFailedLogin_(login);
    users[index] = setUserPassword_(users[index], next, false);
    users = saveLoginUsers_(users);
    clearPasswordResetRequest_(login);

    const updated = users.find(function(item) { return normalizeLogin_(item.usuario) === login; });
    auditLog_(null, 'SENHA_ALTERADA', updated ? updated.usuario : login, 'Senha alterada pelo próprio usuário.');
    return {
      ok: true,
      success: true,
      login: loginResponse_(updated),
      message: 'Senha alterada com sucesso.'
    };
  });
}

function listLoginUsers(auth) {
  requireAdmin_(auth);
  return getLoginUsers_().map(publicLoginUser_);
}

function saveLoginUser(auth, payload) {
  const admin = requireAdmin_(auth);
  payload = payload || {};

  const original = normalizeLogin_(payload.original || payload.usuario);
  const usuario = normalizeLogin_(payload.usuario);
  const nome = String(payload.nome || '').trim();
  const perfil = normalizeLogin_(payload.perfil || 'operador') === 'admin' ? 'admin' : 'operador';
  const ativo = payload.ativo !== false;
  const novaSenha = String(payload.senha || '');

  if (!nome) throw new Error('Informe o nome do usuário.');
  if (!usuario) throw new Error('Informe o login do usuário.');
  if (!LOGIN_USER_PATTERN.test(usuario)) {
    throw new Error('O login deve ter de 3 a 40 caracteres e usar apenas letras, números, ponto, hífen ou sublinhado.');
  }

  const editingSelf = normalizeLogin_(admin.usuario) === (original || usuario);
  if (editingSelf && (!ativo || perfil !== 'admin')) {
    throw new Error('Você não pode remover seu próprio acesso de administrador.');
  }

  return withScriptLock_(function() {
    let users = getLoginUsers_();
    const duplicate = users.find(function(item) {
      const key = normalizeLogin_(item.usuario);
      return key === usuario && key !== original;
    });
    if (duplicate) {
      throw new Error('Já existe um usuário cadastrado com este login.');
    }

    const previous = users.find(function(item) {
      return normalizeLogin_(item.usuario) === original || normalizeLogin_(item.usuario) === usuario;
    });

    let finalUser = previous ? cleanLoginUser_(previous) : {};
    finalUser.nome = nome;
    finalUser.usuario = usuario;
    finalUser.perfil = perfil;
    finalUser.ativo = ativo;

    if (novaSenha) {
      const validationMessage = validatePasswordStrength_(usuario, novaSenha, '', finalUser);
      if (validationMessage) {
        throw new Error(validationMessage);
      }
      finalUser = setUserPassword_(finalUser, novaSenha, true);
    } else if (!finalUser.senhaHash) {
      throw new Error('Informe uma senha para novo usuário.');
    }

    users = users.filter(function(item) {
      const key = normalizeLogin_(item.usuario);
      return key !== original && key !== usuario;
    });
    users.push(finalUser);
    saveLoginUsers_(users);
    clearPasswordResetRequest_(usuario);
    auditLog_(null, previous ? 'USUARIO_ATUALIZADO' : 'USUARIO_CRIADO', admin.usuario, 'Usuário afetado: ' + usuario + '. Perfil: ' + perfil + '. Ativo: ' + ativo + '.');

    return getLoginUsers_().map(publicLoginUser_);
  });
}

function deleteLoginUser(auth, usuario) {
  const admin = requireAdmin_(auth);
  const login = normalizeLogin_(usuario);
  if (!login) throw new Error('Login inválido.');
  if (login === normalizeLogin_(admin.usuario)) {
    throw new Error('Você não pode excluir o usuário logado.');
  }

  return withScriptLock_(function() {
    const users = getLoginUsers_();
    const exists = users.some(function(item) {
      return normalizeLogin_(item.usuario) === login;
    });
    if (!exists) throw new Error('Usuário não encontrado.');

    const nextUsers = users.filter(function(item) {
      return normalizeLogin_(item.usuario) !== login;
    });
    saveLoginUsers_(nextUsers);
    clearPasswordResetRequest_(login);
    auditLog_(null, 'USUARIO_EXCLUIDO', admin.usuario, 'Usuário excluído: ' + login + '.');
    return getLoginUsers_().map(publicLoginUser_);
  });
}


function requestPasswordReset(usuario) {
  const login = normalizeLogin_(usuario);
  if (!login) {
    return { ok: false, success: false, message: 'Informe o usuário para solicitar a redefinição.' };
  }

  const exists = getLoginUsers_().some(function(user) {
    return normalizeLogin_(user.usuario) === login && user.ativo !== false;
  });

  // Mensagem intencionalmente generica para nao confirmar detalhes alem do necessario.
  if (!exists) {
    return { ok: true, success: true, message: 'Se o usuário existir, a solicitação foi registrada. Peça ao administrador para redefinir a senha provisória.' };
  }

  return withScriptLock_(function() {
    const props = PropertiesService.getScriptProperties();
    let requests = {};
    try {
      requests = JSON.parse(props.getProperty(PASSWORD_RESET_REQUESTS_PROPERTY) || '{}') || {};
    } catch (err) {
      requests = {};
    }
    requests[login] = new Date().toISOString();
    props.setProperty(PASSWORD_RESET_REQUESTS_PROPERTY, JSON.stringify(requests));

    return { ok: true, success: true, message: 'Solicitação registrada. Peça ao administrador para redefinir sua senha provisória.' };
  });
}

function readPasswordResetRequests_() {
  const props = PropertiesService.getScriptProperties();
  try {
    return JSON.parse(props.getProperty(PASSWORD_RESET_REQUESTS_PROPERTY) || '{}') || {};
  } catch (err) {
    return {};
  }
}

function clearPasswordResetRequest_(usuario) {
  const login = normalizeLogin_(usuario);
  if (!login) return;

  const props = PropertiesService.getScriptProperties();
  const requests = readPasswordResetRequests_();
  if (!requests[login]) return;
  delete requests[login];
  props.setProperty(PASSWORD_RESET_REQUESTS_PROPERTY, JSON.stringify(requests));
}

function listPasswordResetRequests(auth) {
  requireAdmin_(auth);
  const requests = readPasswordResetRequests_();
  const users = getLoginUsers_();
  return Object.keys(requests).sort().map(function(login) {
    const user = users.find(function(item) {
      return normalizeLogin_(item.usuario) === login;
    });
    return {
      usuario: login,
      nome: user ? user.nome : login,
      requestedAt: requests[login],
      ativo: user ? user.ativo !== false : false
    };
  });
}

function resetUserPassword(auth, usuario, senhaProvisoria) {
  const admin = requireAdmin_(auth);
  const login = normalizeLogin_(usuario);
  const temporaryPassword = String(senhaProvisoria || '');
  if (!login) throw new Error('Login inválido.');
  if (!temporaryPassword) throw new Error('Informe a senha provisória.');

  return withScriptLock_(function() {
    let users = getLoginUsers_();
    const index = users.findIndex(function(user) {
      return normalizeLogin_(user.usuario) === login;
    });
    if (index < 0) throw new Error('Usuário não encontrado.');

    const validationMessage = validatePasswordStrength_(login, temporaryPassword, '', users[index]);
    if (validationMessage) {
      throw new Error(validationMessage);
    }

    users[index] = setUserPassword_(users[index], temporaryPassword, true);
    saveLoginUsers_(users);
    clearPasswordResetRequest_(login);
    auditLog_(null, 'SENHA_REDEFINIDA_MANUAL', admin.usuario, 'Usuário afetado: ' + login + '.');
    return getLoginUsers_().map(publicLoginUser_);
  });
}

function getLoginBackendStatus(auth) {
  const users = getLoginUsers_().map(publicLoginUser_);
  const requester = getSessionUser_(auth);
  const admin = isActiveAdmin_(requester);
  const resetRequests = readPasswordResetRequests_();
  return {
    ok: true,
    success: true,
    backendVersion: BACKEND_VERSION,
    loginUsersProperty: LOGIN_USERS_PROPERTY,
    firstAccessEnabled: true,
    authRequiredForFechamentos: AUTH_REQUIRED_FOR_FECHAMENTOS,
    passwordMinLength: MIN_PASSWORD_LENGTH,
    loginLockoutMinutes: Math.ceil(LOGIN_LOCKOUT_SECONDS / 60),
    defaultUsersCount: DEFAULT_LOGIN_USERS_SERVER.length,
    usersCount: users.length,
    passwordResetRequestsCount: Object.keys(resetRequests).length,
    users: admin ? users : []
  };
}

function getSystemHealth(auth) {
  const admin = requireAdmin_(auth);
  const ss = getOrCreateSpreadsheet_();
  const sh = ensureSheetHeaders_(ss);
  const audit = ensureAuditSheet_(ss);
  return {
    ok: true,
    success: true,
    checkedBy: publicLoginUser_(admin),
    backendVersion: BACKEND_VERSION,
    spreadsheetName: ss.getName(),
    spreadsheetId: ss.getId(),
    spreadsheetUrl: ss.getUrl(),
    spreadsheetConnection: inspectSpreadsheetConnection_(),
    fechamentosRows: Math.max(sh.getLastRow() - 1, 0),
    auditoriaRows: Math.max(audit.getLastRow() - 1, 0),
    usuariosAtivos: getLoginUsers_().filter(function(user) { return user.ativo !== false; }).length,
    passwordResetRequestsCount: Object.keys(readPasswordResetRequests_()).length,
    timezone: Session.getScriptTimeZone()
  };
}

function getSpreadsheetConnectionStatus(auth) {
  requireAdmin_(auth);
  return inspectSpreadsheetConnection_();
}

function reconectarPlanilha(auth, spreadsheetIdOrUrl) {
  const admin = requireAdmin_(auth);
  return withScriptLock_(function() {
    return setSpreadsheetConnection_(spreadsheetIdOrUrl, admin.usuario);
  });
}

function reconectarPlanilhaManual() {
  if (!String(MANUAL_SPREADSHEET_ID || '').trim()) {
    throw new Error('Cole o ID ou link da planilha na constante MANUAL_SPREADSHEET_ID e execute novamente.');
  }
  return withScriptLock_(function() {
    return setSpreadsheetConnection_(MANUAL_SPREADSHEET_ID, 'manual-editor');
  });
}

function exportFechamentosJson(auth, limit) {
  const admin = requireAdmin_(auth);
  limit = normalizeLimit_(limit, MAX_LIST_LIMIT, 500);

  const ss = getOrCreateSpreadsheet_();
  const sh = ensureSheetHeaders_(ss);
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) {
    return { ok: true, success: true, exportedAt: new Date().toISOString(), count: 0, items: [] };
  }

  const startRow = Math.max(2, lastRow - limit + 1);
  const numRows = lastRow - startRow + 1;
  const values = sh.getRange(startRow, 1, numRows, Math.max(sh.getLastColumn(), SHEET_HEADERS.length)).getValues();
  const items = values.map(function(row) {
    const json = row[18];
    try {
      return json ? JSON.parse(json) : null;
    } catch (err) {
      return { id: cellDisplay_(row[0]), erro: 'JSON corrompido: ' + err.message };
    }
  }).filter(function(item) {
    return !!item;
  });

  auditLog_(ss, 'EXPORTACAO_JSON', admin.usuario, 'Quantidade exportada: ' + items.length + '.');
  return { ok: true, success: true, exportedAt: new Date().toISOString(), count: items.length, items: items };
}

// ----------------------------------------------------------------------------
// Web app / templates
// ----------------------------------------------------------------------------
function doGet(e) {
  const output = HtmlService
    .createTemplateFromFile('index')
    .evaluate()
    .setTitle(APP_NAME);

  if (ALLOW_IFRAME_EMBEDDING) {
    output.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  return output;
}

/** Permite incluir outros arquivos HTML dentro do template, se necessário. */
function include(filename) {
  filename = String(filename || '').trim();
  if (!INCLUDE_FILE_PATTERN.test(filename)) {
    throw new Error('Nome de arquivo HTML inválido.');
  }
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** Cria/configura a planilha manualmente (útil na primeira execução). */
function setupManual() {
  return withScriptLock_(function() {
    const ss = getOrCreateSpreadsheet_();
    ensureSheetHeaders_(ss);
    ensureAuditSheet_(ss);
    auditLog_(ss, 'SETUP_MANUAL', 'manual', 'Base criada ou reconfigurada manualmente.');
    return {
      ok: true,
      name: ss.getName(),
      id: ss.getId(),
      url: ss.getUrl(),
      message: 'Base criada/configurada com sucesso.'
    };
  });
}

/** Informações exibidas no painel (link da base, usuário ativo, fuso). */
function getAppInfo(auth) {
  const ss = getOrCreateSpreadsheet_();
  const sessionUser = getSessionUser_(auth);
  return {
    appName: APP_NAME,
    backendVersion: BACKEND_VERSION,
    spreadsheetName: ss.getName(),
    spreadsheetUrl: ss.getUrl(),
    user: sessionUser ? sessionUser.nome : getActiveEmail_(),
    loginUser: sessionUser ? publicLoginUser_(sessionUser) : null,
    timezone: Session.getScriptTimeZone(),
    authRequiredForFechamentos: AUTH_REQUIRED_FOR_FECHAMENTOS,
    loginTokenTtlSeconds: LOGIN_TOKEN_TTL_SECONDS
  };
}

// ----------------------------------------------------------------------------
// CRUD de fechamentos
// ----------------------------------------------------------------------------

/** Cria (ou atualiza, se o ID já existir) um fechamento na planilha. */
function saveFechamento(payload, auth) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload inválido.');
  }

  const authValue = auth || payload.auth || payload.authToken || payload.sessionToken || payload.loginToken || payload.userToken;
  const sessionUser = AUTH_REQUIRED_FOR_FECHAMENTOS ? requireSession_(authValue) : requireValidSessionIfProvided_(authValue);

  return withScriptLock_(function() {
    const ss  = getOrCreateSpreadsheet_();
    const sh  = ensureSheetHeaders_(ss);
    const now = new Date();
    const cleanPayload = stripAuthFields_(clonePayload_(payload));
    const id  = sanitizeId_(cleanPayload.id) || Utilities.getUuid();

    cleanPayload.id        = id;
    cleanPayload.updatedAt = now.toISOString();
    if (!cleanPayload.createdAt) cleanPayload.createdAt = now.toISOString();

    // Preserva a data de criacao original em caso de atualizacao.
    const existingRow = findRowById_(sh, id);
    let createdAt = now;
    if (existingRow > 1) {
      const oldCreated = sh.getRange(existingRow, 2).getValue();
      if (oldCreated) createdAt = oldCreated;
    }
    cleanPayload.createdAt = toIsoDateString_(createdAt) || cleanPayload.createdAt || now.toISOString();

    const k = cleanPayload.kpis    || {};
    const m = cleanPayload.metrics || {};
    const json = JSON.stringify(cleanPayload);
    if (json.length > JSON_CELL_MAX_LENGTH) {
      throw new Error('O fechamento ficou grande demais para salvar em uma única célula do Google Sheets. Reduza anexos/textos ou divida o registro.');
    }

    const row = [
      id,
      createdAt,
      now,
      sessionUser ? (sessionUser.nome + ' (' + sessionUser.usuario + ')') : getActiveEmail_(),
      safeCell_(cleanPayload.date),
      safeCell_(cleanPayload.shift),
      safeCell_(cleanPayload.title),
      safeCell_(k.absT1),
      safeCell_(k.dotT1),
      safeCell_(k.ootT1),
      safeCell_(k.dotDia),
      safeCell_(k.ootDia),
      safeCell_(k.dotSemana),
      safeCell_(m.avgDot),
      safeCell_(m.totalPcts),
      safeCell_(m.totalParsedLoss),
      safeCell_(m.worstHour),
      safeCell_(cleanPayload.statusResumo),
      json
    ];

    let savedRow = existingRow;
    if (existingRow > 1) {
      sh.getRange(existingRow, 1, 1, row.length).setValues([row]);
    } else {
      sh.appendRow(row);
      savedRow = sh.getLastRow();
    }

    formatSavedRow_(sh, savedRow);
    ensureSheetFilter_(sh);
    auditLog_(ss, existingRow > 1 ? 'FECHAMENTO_ATUALIZADO' : 'FECHAMENTO_CRIADO', sessionUser.usuario, 'ID: ' + id + '. Titulo: ' + safeAuditText_(cleanPayload.title) + '.');
    return {
      ok: true,
      id: id,
      savedAt: Utilities.formatDate(now, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss'),
      sheetUrl: ss.getUrl(),
      message: 'Fechamento salvo com sucesso.'
    };
  });
}

/** Lista os últimos fechamentos (mais recentes primeiro). */
function listFechamentos(limit, auth) {
  if (AUTH_REQUIRED_FOR_FECHAMENTOS) {
    requireSession_(auth);
  } else {
    requireValidSessionIfProvided_(auth);
  }
  limit = normalizeLimit_(limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);

  const ss = getOrCreateSpreadsheet_();
  const sh = ensureSheetHeaders_(ss);
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return [];

  const startRow = Math.max(2, lastRow - limit + 1);
  const numRows = lastRow - startRow + 1;
  const values = sh.getRange(startRow, 1, numRows, Math.max(sh.getLastColumn(), SHEET_HEADERS.length)).getValues();
  return values
    .filter(function(row) { return row[0]; })
    .reverse()
    .map(function(row) {
      return {
        id:              cellDisplay_(row[0]),
        createdAt:       formatMaybeDate_(row[1]),
        updatedAt:       formatMaybeDate_(row[2]),
        user:            cellDisplay_(row[3]),
        date:            formatDateOnly_(row[4]),
        shift:           cellDisplay_(row[5]),
        title:           cellDisplay_(row[6]),
        absT1:           cellDisplay_(row[7]),
        dotT1:           cellDisplay_(row[8]),
        ootT1:           cellDisplay_(row[9]),
        dotDia:          cellDisplay_(row[10]),
        ootDia:          cellDisplay_(row[11]),
        dotSemana:       cellDisplay_(row[12]),
        avgDot:          cellDisplay_(row[13]),
        totalPcts:       cellDisplay_(row[14]),
        totalParsedLoss: cellDisplay_(row[15]),
        worstHour:       cellDisplay_(row[16]),
        statusResumo:    cellDisplay_(row[17])
      };
    });
}

/** Retorna o payload completo (JSON) de um fechamento pelo ID. */
function getFechamento(id, auth) {
  if (AUTH_REQUIRED_FOR_FECHAMENTOS) {
    requireSession_(auth);
  } else {
    requireValidSessionIfProvided_(auth);
  }
  id = sanitizeId_(id);
  if (!id) throw new Error('ID não informado.');

  const ss  = getOrCreateSpreadsheet_();
  const sh  = ensureSheetHeaders_(ss);
  const row = findRowById_(sh, id);
  if (row <= 1) throw new Error('Fechamento não encontrado.');

  const json = sh.getRange(row, 19).getValue();
  if (!json) throw new Error('Registro sem JSON salvo.');

  try {
    return JSON.parse(json);
  } catch (e) {
    throw new Error('JSON do fechamento está corrompido: ' + e.message);
  }
}

/** Exclui um fechamento pelo ID. */
function deleteFechamento(id, auth) {
  const sessionUser = requireAdmin_(auth);
  id = sanitizeId_(id);
  if (!id) throw new Error('ID não informado.');

  return withScriptLock_(function() {
    const ss  = getOrCreateSpreadsheet_();
    const sh  = ensureSheetHeaders_(ss);
    const row = findRowById_(sh, id);
    if (row <= 1) throw new Error('Fechamento não encontrado.');

    sh.deleteRow(row);
    ensureSheetFilter_(sh);
    auditLog_(ss, 'FECHAMENTO_EXCLUIDO', sessionUser.usuario, 'ID: ' + id + '.');
    return { ok: true, message: 'Fechamento excluído.' };
  });
}

// ----------------------------------------------------------------------------
// Helpers de planilha
// ----------------------------------------------------------------------------

/** Abre a planilha salva nas propriedades; cria uma nova se não existir. */
function getOrCreateSpreadsheet_() {
  const props   = PropertiesService.getScriptProperties();
  const savedId = extractSpreadsheetId_(props.getProperty(PROP_SPREADSHEET_ID) || '');
  const manualId = extractSpreadsheetId_(MANUAL_SPREADSHEET_ID);

  // Nesta versao, a planilha original enviada pelo usuario e a fonte oficial.
  // Se a propriedade interna apontar para outra base, reconecta automaticamente.
  if (manualId && savedId !== manualId) {
    const manual = openConfiguredSpreadsheet_(manualId, 'MANUAL_SPREADSHEET_ID');
    props.setProperty(PROP_SPREADSHEET_ID, manual.getId());
    return manual;
  }

  if (savedId) {
    try {
      const ss = SpreadsheetApp.openById(savedId);
      ensureSheetHeaders_(ss);
      ensureAuditSheet_(ss);
      return ss;
    } catch (err) {
      // ID inválido (planilha apagada, por ex.): limpa e recria abaixo.
      props.deleteProperty(PROP_SPREADSHEET_ID);
    }
  }

  if (manualId) {
    const manual = openConfiguredSpreadsheet_(manualId, 'MANUAL_SPREADSHEET_ID');
    props.setProperty(PROP_SPREADSHEET_ID, manual.getId());
    return manual;
  }

  const active = getActiveSpreadsheetIfAvailable_();
  if (active) {
    props.setProperty(PROP_SPREADSHEET_ID, active.getId());
    ensureSheetHeaders_(active);
    ensureAuditSheet_(active);
    return active;
  }

  const ss = SpreadsheetApp.create(SPREADSHEET_NAME);
  props.setProperty(PROP_SPREADSHEET_ID, ss.getId());
  ensureSheetHeaders_(ss);
  ensureAuditSheet_(ss);
  return ss;
}

function getActiveSpreadsheetIfAvailable_() {
  try {
    return SpreadsheetApp.getActiveSpreadsheet();
  } catch (err) {
    return null;
  }
}

function openConfiguredSpreadsheet_(spreadsheetId, sourceLabel) {
  try {
    const ss = SpreadsheetApp.openById(spreadsheetId);
    ensureSheetHeaders_(ss);
    ensureAuditSheet_(ss);
    return ss;
  } catch (err) {
    throw new Error('Não consegui abrir a planilha configurada em ' + sourceLabel + ': ' + err.message);
  }
}

function extractSpreadsheetId_(spreadsheetIdOrUrl) {
  const text = String(spreadsheetIdOrUrl || '').trim();
  if (!text) return '';

  const urlMatch = text.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (urlMatch && urlMatch[1]) return urlMatch[1];

  const idMatch = text.match(/[A-Za-z0-9_-]{20,}/);
  return idMatch ? idMatch[0] : '';
}

function setSpreadsheetConnection_(spreadsheetIdOrUrl, actor) {
  const id = extractSpreadsheetId_(spreadsheetIdOrUrl);
  if (!id) {
    throw new Error('Informe um ID ou link válido da planilha.');
  }

  const ss = SpreadsheetApp.openById(id);
  ensureSheetHeaders_(ss);
  ensureAuditSheet_(ss);
  PropertiesService.getScriptProperties().setProperty(PROP_SPREADSHEET_ID, ss.getId());
  auditLog_(ss, 'PLANILHA_RECONECTADA', actor || 'sistema', 'Planilha conectada: ' + ss.getId() + '.');

  return {
    ok: true,
    success: true,
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
    spreadsheetUrl: ss.getUrl(),
    message: 'Planilha reconectada com sucesso.'
  };
}

function inspectSpreadsheetConnection_() {
  const props = PropertiesService.getScriptProperties();
  const savedId = props.getProperty(PROP_SPREADSHEET_ID) || '';
  const manualId = extractSpreadsheetId_(MANUAL_SPREADSHEET_ID);
  let saved = null;
  let manual = null;
  let active = null;
  let error = '';

  if (savedId) {
    try {
      const ss = SpreadsheetApp.openById(savedId);
      saved = {
        id: ss.getId(),
        name: ss.getName(),
        url: ss.getUrl()
      };
    } catch (err) {
      error = 'ID salvo não abriu: ' + err.message;
    }
  }

  if (manualId) {
    try {
      const ss = SpreadsheetApp.openById(manualId);
      manual = {
        id: ss.getId(),
        name: ss.getName(),
        url: ss.getUrl()
      };
    } catch (err) {
      error = [error, 'ID manual não abriu: ' + err.message].filter(Boolean).join(' | ');
    }
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) {
      active = {
        id: ss.getId(),
        name: ss.getName(),
        url: ss.getUrl()
      };
    }
  } catch (err) {
    active = null;
  }

  return {
    ok: !!(saved || manual || active),
    success: !!(saved || manual || active),
    propertyName: PROP_SPREADSHEET_ID,
    savedId: savedId,
    manualConfiguredId: manualId,
    savedSpreadsheet: saved,
    manualSpreadsheet: manual,
    activeSpreadsheet: active,
    propertyMatchesManual: !!(manualId && savedId === manualId),
    usingManualFallback: !!(manual && savedId !== manualId),
    usingActiveFallback: !!(!saved && !manual && active),
    error: error
  };
}

/** Garante que a aba e o cabeçalho existam; retorna a aba de fechamentos. */
function ensureSheetHeaders_(ss) {
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);

  const current = sh.getRange(1, 1, 1, SHEET_HEADERS.length).getValues()[0];
  const needsHeaderUpdate = current.join('') === '' || SHEET_HEADERS.some(function(header, index) {
    return current[index] !== header;
  });

  if (needsHeaderUpdate) {
    sh.getRange(1, 1, 1, SHEET_HEADERS.length).setValues([SHEET_HEADERS]);
    formatSheet_(sh);
  }
  return sh;
}

function ensureAuditSheet_(ss) {
  let sh = ss.getSheetByName(AUDIT_SHEET_NAME);
  if (!sh) sh = ss.insertSheet(AUDIT_SHEET_NAME);

  const current = sh.getRange(1, 1, 1, AUDIT_HEADERS.length).getValues()[0];
  const needsHeaderUpdate = current.join('') === '' || AUDIT_HEADERS.some(function(header, index) {
    return current[index] !== header;
  });

  if (needsHeaderUpdate) {
    sh.getRange(1, 1, 1, AUDIT_HEADERS.length).setValues([AUDIT_HEADERS]);
    sh.getRange(1, 1, 1, AUDIT_HEADERS.length)
      .setFontWeight('bold')
      .setFontFamily('Arial')
      .setFontSize(10)
      .setBackground('#134E4A')
      .setFontColor('#FFFFFF')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 145);
    sh.setColumnWidth(2, 210);
    sh.setColumnWidth(3, 180);
    sh.setColumnWidth(4, 520);
  }

  return sh;
}

function auditLog_(ss, eventName, usuario, details) {
  try {
    const target = ss || getOrCreateSpreadsheet_();
    const sh = ensureAuditSheet_(target);
    sh.appendRow([
      new Date(),
      safeCell_(eventName),
      safeCell_(usuario || 'sistema'),
      safeCell_(safeAuditText_(details))
    ]);
    const row = sh.getLastRow();
    if (row > 1) {
      sh.getRange(row, 1, 1, AUDIT_HEADERS.length)
        .setFontFamily('Arial')
        .setFontSize(10)
        .setVerticalAlignment('top')
        .setWrap(true);
      sh.getRange(row, 1, 1, 1).setNumberFormat('dd/mm/yyyy hh:mm:ss');
    }
  } catch (err) {
    // Auditoria nao pode impedir a operacao principal.
  }
}

/** Aplica formatação (cabeçalho, larguras e formatos de data). */
function formatSheet_(sh) {
  const lastCol = Math.max(sh.getLastColumn(), SHEET_HEADERS.length);
  const lastRow = Math.max(sh.getLastRow(), 1);

  // Cabecalho com visual mais limpo para leitura no painel/planilha interna.
  sh.getRange(1, 1, 1, lastCol)
    .setFontWeight('bold')
    .setFontFamily('Arial')
    .setFontSize(10)
    .setBackground('#0F172A')
    .setFontColor('#FFFFFF')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);
  sh.setFrozenRows(1);
  sh.setRowHeight(1, 42);

  const widths = [190, 145, 145, 220, 100, 80, 260, 82, 82, 82, 82, 82, 98, 110, 115, 135, 145, 180, 560];
  widths.forEach(function(w, i) { sh.setColumnWidth(i + 1, w); });

  if (lastRow > 1) {
    const bodyRows = lastRow - 1;
    formatDataRange_(sh, 2, bodyRows, lastCol);
    sh.getRange(2, 2, bodyRows, 2).setNumberFormat('dd/mm/yyyy hh:mm:ss');
    sh.getRange(2, 5, bodyRows, 1).setNumberFormat('dd/mm/yyyy');
    sh.getRange(2, 8, bodyRows, 10).setHorizontalAlignment('center');
    sh.getRange(2, 7, bodyRows, 1).setWrap(true);
    sh.getRange(2, 18, bodyRows, 1).setWrap(true);
    sh.getRange(2, 19, bodyRows, 1).setWrap(false);
  }

  ensureSheetFilter_(sh);
}

function formatDataRange_(sh, rowStart, rowCount, lastCol) {
  if (rowCount <= 0) return;
  sh.getRange(rowStart, 1, rowCount, lastCol)
    .setFontFamily('Arial')
    .setFontSize(10)
    .setVerticalAlignment('top')
    .setWrap(false);
}

function formatSavedRow_(sh, rowNumber) {
  if (!rowNumber || rowNumber <= 1) return;
  const lastCol = Math.max(sh.getLastColumn(), SHEET_HEADERS.length);
  formatDataRange_(sh, rowNumber, 1, lastCol);
  sh.getRange(rowNumber, 2, 1, 2).setNumberFormat('dd/mm/yyyy hh:mm:ss');
  sh.getRange(rowNumber, 5, 1, 1).setNumberFormat('dd/mm/yyyy');
  sh.getRange(rowNumber, 8, 1, 10).setHorizontalAlignment('center');
  sh.getRange(rowNumber, 7, 1, 1).setWrap(true);
  sh.getRange(rowNumber, 18, 1, 1).setWrap(true);
  sh.getRange(rowNumber, 19, 1, 1).setWrap(false);
}

function ensureSheetFilter_(sh) {
  try {
    const lastCol = Math.max(sh.getLastColumn(), SHEET_HEADERS.length);
    const lastRow = Math.max(sh.getLastRow(), 1);
    const targetRange = sh.getRange(1, 1, lastRow, lastCol);
    const filter = sh.getFilter();
    if (!filter) {
      targetRange.createFilter();
      return;
    }
    if (filter.getRange().getA1Notation() !== targetRange.getA1Notation()) {
      filter.remove();
      targetRange.createFilter();
    }
  } catch (err) {
    // Nao bloqueia o salvamento se o filtro ja existir ou se a planilha recusar filtros.
  }
}

/** Localiza a linha (1-based) de um fechamento pelo ID; -1 se não achar. */
function findRowById_(sh, id) {
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return -1;

  const target = sanitizeId_(id);
  if (!target) return -1;

  const found = sh.getRange(2, 1, lastRow - 1, 1)
    .createTextFinder(target)
    .matchEntireCell(true)
    .findNext();
  return found ? found.getRow() : -1;
}

// ----------------------------------------------------------------------------
// Utilitários
// ----------------------------------------------------------------------------
function getActiveEmail_() {
  try {
    return Session.getActiveUser().getEmail() || 'Usuário não identificado';
  } catch (err) {
    return 'Usuário não identificado';
  }
}

function safeCell_(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  // Evita interpretacao como formula no Sheets sem quebrar numeros negativos comuns.
  if (/^[\t\r\n]/.test(text) || /^\s*[=@]/.test(text) || /^\s*[+-](?!\d|[.,]\d)/.test(text)) {
    return "'" + text;
  }
  return text;
}

function cellDisplay_(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function sanitizeId_(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, 120);
}

function normalizeLimit_(limit, fallback, max) {
  const parsed = Math.floor(Number(limit));
  if (!isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function clonePayload_(payload) {
  try {
    return JSON.parse(JSON.stringify(payload || {}));
  } catch (err) {
    return Object.assign({}, payload || {});
  }
}

function stripAuthFields_(payload) {
  payload = payload || {};
  delete payload.auth;
  delete payload.authToken;
  delete payload.sessionToken;
  delete payload.loginToken;
  delete payload.userToken;
  return payload;
}

function safeAuditText_(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function toIsoDateString_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) {
    return value.toISOString();
  }
  if (value === null || value === undefined || value === '') return '';
  const parsed = new Date(value);
  if (!isNaN(parsed)) return parsed.toISOString();
  return String(value);
}

function formatMaybeDate_(value) {
  if (value === null || value === undefined || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss');
  }
  return String(value);
}

function formatDateOnly_(value) {
  if (value === null || value === undefined || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value)) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  }
  return String(value);
}
