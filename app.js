(function() {
    'use strict';
    
    var CONFIG = {
        supabaseUrl: 'https://zeiwdwplhgcpedhoxxqd.supabase.co',
        supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InplaXdkd3BsaGdjcGVkaG94eHFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MTk5NjIsImV4cCI6MjA4OTA5NTk2Mn0.R4sBgsv--4WS9Pp230Y3Qhm3efHw2itzRaHgaw856VA'
    };

    var appState = {
        supabase: null,
        currentUser: null,
        currentNotebookId: null,
        currentNoteId: null,
        editingFileCard: null
    };

    var hiddenInputs = {};
    var activeModalPreviousFocus = null;
    var activeModalId = null;

    function debug(msg) {
        var panel = document.getElementById('debugPanel');
        var time = new Date().toLocaleTimeString();
        panel.innerHTML += '[' + time + '] ' + msg + '<br>';
        panel.scrollTop = panel.scrollHeight;
        console.log('[DEBUG]', msg);
    }

    function showToast(message, type) {
        type = type || 'success';
        var toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = 'toast show ' + type;
        setTimeout(function() {
            toast.classList.remove('show');
        }, 3000);
    }

    function isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    function escapeHtml(text) {
        if (!text) return '';
        return text.replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;')
                  .replace(/'/g, '&#039;');
    }

    function sanitizeNoteHtml(html) {
        if (!html) return '';
        if (typeof DOMPurify === 'undefined') return html;
        return DOMPurify.sanitize(html, {
            USE_PROFILES: { html: true },
            ADD_ATTR: ['style', 'target', 'rel', 'data-file-url', 'data-file-name', 'data-file-remark', 'controls', 'src', 'loading', 'contenteditable', 'cite'],
            ALLOW_DATA_ATTR: true
        });
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        var date = new Date(dateStr);
        return date.toLocaleString('zh-CN');
    }

    function getFriendlyError(message) {
        if (!message) return '操作失败';
        if (message.includes('Invalid login')) return '邮箱或密码错误';
        if (message.includes('Email')) return '邮箱格式问题';
        if (message.includes('Password')) return '密码强度不足';
        if (message.includes('Network')) return '网络连接失败';
        if (message.includes('already')) return '该邮箱已注册';
        if (message.includes('relation')) return '数据库表未配置';
        if (message.includes('permission') || message.includes('RLS')) return '权限不足，请检查 RLS 策略';
        if (message.includes('user_id')) return '用户信息不完整';
        if (message.includes('JWT')) return '登录已过期，请重新登录';
        return message;
    }

    function getFocusableInModal(modalOverlay) {
        var panel = modalOverlay.querySelector('.modal');
        if (!panel) return [];
        var nodes = panel.querySelectorAll(
            'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])'
        );
        return Array.prototype.slice.call(nodes).filter(function(el) {
            return el.offsetParent !== null || el.getClientRects().length > 0;
        });
    }

    function onModalKeydown(e) {
        if (!activeModalId) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            hideModal(activeModalId);
            return;
        }
        if (e.key !== 'Tab') return;
        var modal = document.getElementById(activeModalId + 'Modal');
        if (!modal || !modal.classList.contains('show')) return;
        var focusables = getFocusableInModal(modal);
        if (focusables.length === 0) return;
        var first = focusables[0];
        var last = focusables[focusables.length - 1];
        if (e.shiftKey) {
            if (document.activeElement === first) {
                e.preventDefault();
                last.focus();
            }
        } else {
            if (document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    }

    function showModal(type, options) {
        options = options || {};
        var modal = document.getElementById(type + 'Modal');
        if (!modal) return;
        activeModalPreviousFocus = document.activeElement;
        activeModalId = type;
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
        document.addEventListener('keydown', onModalKeydown);
        setTimeout(function() {
            if (options.focusSelector) {
                var el = document.querySelector(options.focusSelector);
                if (el && modal.contains(el)) {
                    el.focus();
                    return;
                }
            }
            var focusables = getFocusableInModal(modal);
            if (focusables.length) focusables[0].focus();
        }, 0);
    }

    function hideModal(type) {
        var modal = document.getElementById(type + 'Modal');
        if (!modal) return;
        modal.classList.remove('show');
        document.removeEventListener('keydown', onModalKeydown);
        if (!document.querySelector('.modal-overlay.show')) {
            document.body.style.overflow = '';
        }
        if (activeModalId === type && activeModalPreviousFocus && activeModalPreviousFocus.focus) {
            try { activeModalPreviousFocus.focus(); } catch (err) {}
        }
        activeModalId = null;
        activeModalPreviousFocus = null;
    }

    function switchModal(from, to) {
        hideModal(from);
        setTimeout(function() {
            showModal(to);
        }, 300);
    }

    function checkAuth() {
        debug('检查登录状态...');
        if (!appState.supabase) {
            debug('Supabase 未初始化');
            updateUIForLoggedOut();
            return;
        }
        
        appState.supabase.auth.getSession().then(function(result) {
            if (result.error) {
                debug('获取会话错误:' + result.error.message);
                updateUIForLoggedOut();
                return;
            }
            
            var session = result.data.session;
            if (session) {
                appState.currentUser = session.user;
                debug('用户已登录，ID:' + appState.currentUser.id);
                updateUIForLoggedIn();
                loadNotebooks();
            } else {
                debug('用户未登录');
                updateUIForLoggedOut();
            }
        }).catch(function(err) {
            debug('检查登录状态异常:' + err.message);
            updateUIForLoggedOut();
        });
    }

    function handleLogin() {
        var email = document.getElementById('loginEmail').value.trim();
        var password = document.getElementById('loginPassword').value.trim();
        var btn = document.getElementById('doLoginBtn');

        if (!email || !password) {
            showToast('请填写邮箱和密码', 'error');
            return;
        }

        btn.disabled = true;
        btn.textContent = '登录中...';
        debug('尝试登录，邮箱:' + email);

        appState.supabase.auth.signInWithPassword({
            email: email,
            password: password
        }).then(function(result) {
            if (result.error) throw result.error;
            
            appState.currentUser = result.data.user;
            showToast('登录成功！', 'success');
            hideModal('login');
            updateUIForLoggedIn();
            loadNotebooks();
            
            document.getElementById('loginEmail').value = '';
            document.getElementById('loginPassword').value = '';
        }).catch(function(err) {
            debug('登录错误:' + err.message);
            showToast('登录失败：' + getFriendlyError(err.message), 'error');
        }).finally(function() {
            btn.disabled = false;
            btn.textContent = '登录';
        });
    }

    function handleRegister() {
        var username = document.getElementById('registerUsername').value.trim();
        var email = document.getElementById('registerEmail').value.trim();
        var password = document.getElementById('registerPassword').value.trim();
        var confirmPassword = document.getElementById('registerConfirmPassword').value.trim();
        var btn = document.getElementById('doRegisterBtn');

        if (!username || username.length < 3 || username.length > 16) {
            showToast('用户名需 3-16 位字符', 'error');
            return;
        }
        if (!email || !isValidEmail(email)) {
            showToast('请输入有效邮箱', 'error');
            return;
        }
        if (!password || password.length < 6 || password.length > 16) {
            showToast('密码需 6-16 位字符', 'error');
            return;
        }
        if (password !== confirmPassword) {
            showToast('两次密码不一致', 'error');
            return;
        }

        btn.disabled = true;
        btn.textContent = '注册中...';
        debug('尝试注册，邮箱:' + email);

        appState.supabase.auth.signUp({
            email: email,
            password: password,
            options: {
                data: { username: username }
            }
        }).then(function(result) {
            if (result.error) throw result.error;

            if (result.data.user) {
                showToast('注册成功！请查收邮箱验证', 'info');
                hideModal('register');
                
                document.getElementById('registerUsername').value = '';
                document.getElementById('registerEmail').value = '';
                document.getElementById('registerPassword').value = '';
                document.getElementById('registerConfirmPassword').value = '';
            }
        }).catch(function(err) {
            debug('注册错误:' + err.message);
            showToast('注册失败：' + getFriendlyError(err.message), 'error');
        }).finally(function() {
            btn.disabled = false;
            btn.textContent = '注册';
        });
    }

    function handleLogout() {
        if (!appState.supabase) return;
        
        debug('用户点击退出登录');
        
        appState.supabase.auth.signOut().then(function() {
            appState.currentUser = null;
            appState.currentNotebookId = null;
            appState.currentNoteId = null;
            
            var notebookList = document.getElementById('notebookList');
            if (notebookList) notebookList.innerHTML = ''; 

            clearContent();
            updateUIForLoggedOut();
            
            showToast('已退出登录', 'info');
            debug('已退出登录，界面已重置');
        }).catch(function(err) {
            debug('退出登录错误:', err);
            showToast('退出失败', 'error');
        });
    }

    function applyCursorPreference() {
        document.body.classList.toggle('use-simple-cursor', localStorage.getItem('yunjianji-simple-cursor') === '1');
    }

    function initCursorPrefUi() {
        var btn = document.getElementById('cursorPrefBtn');
        if (!btn) return;
        var simple = localStorage.getItem('yunjianji-simple-cursor') === '1';
        btn.setAttribute('aria-pressed', simple ? 'true' : 'false');
        btn.textContent = simple ? '个性光标' : '系统光标';
    }

    function toggleCursorPreference() {
        var next = localStorage.getItem('yunjianji-simple-cursor') !== '1';
        localStorage.setItem('yunjianji-simple-cursor', next ? '1' : '0');
        applyCursorPreference();
        initCursorPrefUi();
    }

    function updateUIForLoggedIn() {
        var username = appState.currentUser.user_metadata?.username || 
                      appState.currentUser.email?.split('@')[0] || '用户';
        document.getElementById('userActions').innerHTML = 
            '<span style="color:#8B4513;font-family:\'STKaiti\';margin-right:10px; font-size: 20px;">欢迎，' + 
            escapeHtml(username) + '📜' +'</span>'+
            '<button type="button" class="btn btn-secondary" id="cursorPrefBtn" aria-pressed="' +
            (localStorage.getItem('yunjianji-simple-cursor') === '1' ? 'true' : 'false') + '">' +
            (localStorage.getItem('yunjianji-simple-cursor') === '1' ? '个性光标' : '系统光标') + '</button>' +
            '<button type="button" class="btn btn-danger" id="logoutBtn">退出</button>';
        
        document.getElementById('newNotebookName').disabled = false;
        document.getElementById('createNotebookBtn').disabled = false;
        
        initCursorPrefUi();
        document.getElementById('logoutBtn').addEventListener('click', handleLogout);
        debug('UI 更新为已登录状态');
    }

    function updateUIForLoggedOut() {
        document.getElementById('userActions').innerHTML = 
            '<button type="button" class="btn btn-primary" id="loginBtn2">登录</button>' +
            '<button type="button" class="btn btn-secondary" id="registerBtn2">注册</button>' +
            '<button type="button" class="btn btn-secondary" id="cursorPrefBtn" aria-pressed="' +
            (localStorage.getItem('yunjianji-simple-cursor') === '1' ? 'true' : 'false') + '">' +
            (localStorage.getItem('yunjianji-simple-cursor') === '1' ? '个性光标' : '系统光标') + '</button>';
        
        document.getElementById('newNotebookName').disabled = true;
        document.getElementById('createNotebookBtn').disabled = true;
        document.getElementById('newNotebookName').value = '';
        
        initCursorPrefUi();
        document.getElementById('loginBtn2').addEventListener('click', function() { showModal('login'); });
        document.getElementById('registerBtn2').addEventListener('click', function() { showModal('register'); });
        debug('UI 更新为未登录状态');
    }

    function loadNotebooks() {
        if (!appState.currentUser || !appState.supabase) return;

        var list = document.getElementById('notebookList');
        list.innerHTML = '<div class="loading"></div>';

        // 【优化】仅查询需要的字段，避免加载不必要的数据
        appState.supabase
            .from('notebooks')
            .select('id, name, created_at') // 只查询 id, name, created_at
            .eq('user_id', appState.currentUser.id)
            .order('created_at', { ascending: false })
            .then(function(result) {
                if (result.error) throw result.error;

                var data = result.data || [];
                if (data.length === 0) {
                    list.innerHTML = '<li class="empty-state" style="padding:20px;text-align:center;color:#999;">暂无笔记集，请创建</li>';
                } else {
                    var html = '';
                    for (var i = 0; i < data.length; i++) {
                        var nb = data[i];
                        var isActive = appState.currentNotebookId === nb.id ? 'active' : '';
                        html += '<li class="notebook-item ' + isActive + '" data-id="' + nb.id + '" tabindex="0" role="button" aria-label="打开笔记集：' + escapeHtml(nb.name) + '">' +
                            '<span class="notebook-name">' + escapeHtml(nb.name) + '</span>' +
                            '<div class="notebook-actions">' +
                            '<button type="button" class="btn btn-edit btn-notebook-edit" data-id="' + nb.id + '" data-name="' + escapeHtml(nb.name) + '" aria-label="重命名笔记集：' + escapeHtml(nb.name) + '">改</button>' +
                            '<button type="button" class="btn btn-danger btn-notebook-delete" data-id="' + nb.id + '" aria-label="删除笔记集：' + escapeHtml(nb.name) + '">删</button>' +
                            '</div></li>';
                    }
                    list.innerHTML = html;
                    bindNotebookEvents();
                }
            }).catch(function(err) {
                debug('加载笔记集失败:' + err.message);
                list.innerHTML = '<li class="empty-state" style="color:red">加载失败</li>';
            });
    }

    function bindNotebookEvents() {
        var list = document.getElementById('notebookList');
        
        list.querySelectorAll('.notebook-item').forEach(function(item) {
            item.addEventListener('click', function() {
                var id = this.getAttribute('data-id');
                selectNotebook(id);
            });
            item.addEventListener('keydown', function(e) {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                if (e.target.closest && e.target.closest('.notebook-actions')) return;
                e.preventDefault();
                selectNotebook(item.getAttribute('data-id'));
            });
        });
        
        list.querySelectorAll('.btn-notebook-edit').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var id = this.getAttribute('data-id');
                var name = this.getAttribute('data-name');
                editNotebook(id, name);
            });
        });
        
        list.querySelectorAll('.btn-notebook-delete').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var id = this.getAttribute('data-id');
                deleteNotebook(id);
            });
        });
    }

    function createNotebook() {
        var input = document.getElementById('newNotebookName');
        var btn = document.getElementById('createNotebookBtn');
        var name = input.value.trim();

        if (!name) {
            showToast('请输入笔记集名称', 'error');
            return;
        }

        var notebooks = document.querySelectorAll('.notebook-item');
        for(var i = 0; i < notebooks.length; i++) {
            var existingName = notebooks[i].querySelector('.notebook-name').textContent;
            if(existingName === name) {
                showToast('笔记集名称已存在，请选择其他名称', 'error');
                return;
            }
        }

        btn.disabled = true;
        btn.textContent = '创建...';

        appState.supabase
            .from('notebooks')
            .insert([{ name: name, user_id: appState.currentUser.id }])
            .then(function(result) {
                if (result.error) throw result.error;
                input.value = '';
                showToast('创建成功', 'success');
                loadNotebooks();
            }).catch(function(err) {
                showToast('创建失败：' + getFriendlyError(err.message), 'error');
            }).finally(function() {
                btn.disabled = false;
                btn.textContent = '创建';
            });
    }

    function selectNotebook(notebookId) {
        appState.currentNotebookId = notebookId;
        appState.currentNoteId = null;
        
        document.querySelectorAll('.notebook-item').forEach(function(item) {
            var isActive = item.getAttribute('data-id') === notebookId;
            item.classList.toggle('active', isActive);
        });

        loadNotes(notebookId);
    }

    function loadNotes(notebookId) {
        if (!appState.supabase) return;

        var content = document.getElementById('contentArea');
        content.innerHTML = '<div class="loading"></div>';

        appState.supabase
            .from('notebooks')
            .select('name')
            .eq('id', notebookId)
            .single()
            .then(function(result) {
                if (result.error) throw result.error;
                var notebook = result.data;

                // 【优化】仅查询需要的字段，限制数量，避免加载过多数据
                return appState.supabase
                    .from('notes')
                    .select('id, title, updated_at, content') // 只查询 id, title, updated_at, content
                    .eq('notebook_id', notebookId)
                    .order('updated_at', { ascending: false })
                    .limit(20) // 限制每次最多加载 20 条笔记
                    .then(function(notesResult) {
                        if (notesResult.error) throw notesResult.error;
                        var notes = notesResult.data || [];

                        var notesHtml = '';
                        if (notes.length === 0) {
                            notesHtml = '<div class="empty-state" style="grid-column:1/-1">暂无笔记，快去写一篇吧</div>';
                        } else {
                            for (var i = 0; i < notes.length; i++) {
                                var note = notes[i];
                                // 【优化】截取预览内容，避免加载过长的文本
                                var contentPreview = (note.content || '')
                                    .replace(/<[^>]*>/g, '') // 移除HTML标签
                                    .substring(0, 100); // 截取前100个字符
                                
                                notesHtml += '<div class="note-card" role="button" tabindex="0" data-id="' + note.id + '" aria-label="打开笔记：' + escapeHtml(note.title || '无标题') + '">' +
                                    '<div class="note-card-body">' +
                                        '<h4>' + escapeHtml(note.title || '无标题') + '</h4>' +
                                        '<p>' + escapeHtml(contentPreview) + '...</p>' +
                                    '</div>' +
                                    '<div class="note-card-footer">' +
                                        '<span class="note-time">' + formatDate(note.updated_at) + '</span>' +
                                        '<div class="note-actions">' +
                                            '<button type="button" class="btn btn-edit btn-note-edit" aria-label="编辑此笔记">✏️</button>' +
                                            '<button type="button" class="btn btn-danger btn-note-delete" aria-label="删除此笔记">🗑️</button>' +
                                        '</div>' +
                                    '</div>' +
                                '</div>';
                            }
                        }

                        content.innerHTML = 
                            '<div class="note-header">' +
                            '<h3>' + escapeHtml(notebook.name) + '</h3>' +
                            '<button type="button" class="btn btn-primary" id="createNoteBtn">+ 新建笔记</button>' +
                            '</div>' +
                            '<div class="note-list">' + notesHtml + '</div>';

                        bindNoteEvents();
                    });
            })
            .catch(function(err) {
                debug('加载笔记失败:' + err.message);
                content.innerHTML = '<div class="empty-state" style="color:red">加载失败</div>';
            });
    }

    function bindNoteEvents() {
        var content = document.getElementById('contentArea');
        var notebookId = appState.currentNotebookId;
        
        var createBtn = document.getElementById('createNoteBtn');
        if (createBtn) createBtn.addEventListener('click', createNote);
        
        content.querySelectorAll('.note-card').forEach(function(card) {
            card.addEventListener('click', function(e) {
                if (!e.target.classList.contains('btn')) {
                    editNote(this.getAttribute('data-id'));
                }
            });
            card.addEventListener('keydown', function(e) {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                if (e.target.closest && e.target.closest('.note-actions')) return;
                e.preventDefault();
                editNote(card.getAttribute('data-id'));
            });
        });
        
        content.querySelectorAll('.btn-note-edit').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                editNote(this.closest('.note-card').getAttribute('data-id'));
            });
        });
        
        content.querySelectorAll('.btn-note-delete').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                deleteNote(this.closest('.note-card').getAttribute('data-id'));
            });
        });
    }

    function createNote() {
        appState.currentNoteId = null;
        showEditor('', '');
    }

    function editNote(noteId) {
        if (!appState.supabase) return;
        // 【优化】仅查询需要的字段，避免加载不必要的数据
        appState.supabase
            .from('notes')
            .select('title, content') // 只查询 title 和 content
            .eq('id', noteId)
            .single()
            .then(function(result) {
                if (result.error) throw result.error;
                appState.currentNoteId = noteId;
                showEditor(result.data.title || '', result.data.content || '');
            }).catch(function(err) {
                showToast('加载笔记失败', 'error');
            });
    }

    function showEditor(title, content) {
        var contentArea = document.getElementById('contentArea');
        var isEdit = appState.currentNoteId ? '编辑笔记' : '新建笔记';
        var notebookId = appState.currentNotebookId;
        
        createHiddenInput('imageInput', 'image/*', handleFileSelect);
        createHiddenInput('videoInput', 'video/*', handleFileSelect);
        createHiddenInput('audioInput', 'audio/*', handleFileSelect);
        createHiddenInput('fileInput', '*', handleFileSelect);

        contentArea.innerHTML = 
            '<div class="note-header">' +
            '<h3>' + isEdit + '</h3>' +
            '<div>' +
            '<button type="button" class="btn btn-primary" id="saveNoteBtn">保存墨宝</button>' +
            '<button type="button" class="btn btn-secondary" id="cancelNoteBtn">取消</button>' +
            '<button type="button" class="btn btn-secondary" id="shareNoteBtn">下载分享 (PDF)</button>' +
            '</div></div>' +
            
            '<div class="editor-wrapper">' +
                '<div class="editor-sticky-container" id="stickyContainer">' +
                    '<input type="text" class="editor-title" id="noteTitle" placeholder="在此输入标题..." value="' + escapeHtml(title) + '" aria-label="笔记标题">' +
                    
                    '<div class="editor-toolbar">' +
                        '<div class="toolbar-group">' +
                            '<button type="button" class="toolbar-btn" id="btnUndo" title="撤销" aria-label="撤销">↩️</button>' +
                            '<button type="button" class="toolbar-btn" id="btnRedo" title="重做" aria-label="重做">↪️</button>' +
                        '</div>' +
                        '<div class="toolbar-group">' +
                            '<select class="toolbar-select" id="fontFamily" title="字体" aria-label="字体" style="width: 100px;">' +
                                '<option value="SimSun">宋体</option>' +
                                '<option value="KaiTi">楷体</option>' +
                                '<option value="STKaiti">华文楷体</option>' +
                                '<option value="Microsoft YaHei">微软雅黑</option>' +
                                '<option value="SimHei">黑体</option>' +
                                '<option value="FangSong">仿宋</option>' +
                                '<option value="Arial">Arial</option>' +
                            '</select>' +
                            '<select class="toolbar-select" id="fontSize" title="字号" aria-label="字号" style="width: 80px;">' +
                                '<option value="1">八号</option>' +
                                '<option value="2">九号</option>' +
                                '<option value="3">小四</option>' +
                                '<option value="4" selected>四号</option>' +
                                '<option value="5">小三</option>' +
                                '<option value="6">三号</option>' +
                                '<option value="7">二号</option>' +
                            '</select>' +
                        '</div>' +
                        '<button type="button" class="toolbar-btn toolbar-more-btn" id="toolbarMoreBtn" aria-label="展开或收起更多格式" aria-expanded="false" aria-controls="toolbarCollapsible">⋯</button>' +
                        '<div class="toolbar-collapsible" id="toolbarCollapsible" role="group" aria-label="更多编辑工具">' +
                        '<div class="toolbar-group">' +
                            '<button type="button" class="toolbar-btn" id="btnBold" title="加粗" aria-label="加粗"><b>B</b></button>' +
                            '<button type="button" class="toolbar-btn" id="btnItalic" title="斜体" aria-label="斜体"><i>I</i></button>' +
                            '<button type="button" class="toolbar-btn" id="btnUnderline" title="下划线" aria-label="下划线"><u>U</u></button>' +
                        '</div>' +
                        '<div class="toolbar-group">' +
                            '<button type="button" class="toolbar-btn" id="btnLeft" title="左对齐" aria-label="左对齐">L</button>' +
                            '<button type="button" class="toolbar-btn" id="btnCenter" title="居中" aria-label="居中">C</button>' +
                            '<button type="button" class="toolbar-btn" id="btnRight" title="右对齐" aria-label="右对齐">R</button>' +
                        '</div>' +
                        '<div class="toolbar-group">' +
                            '<button type="button" class="toolbar-btn" id="btnUL" title="无序列表" aria-label="无序列表">•</button>' +
                            '<button type="button" class="toolbar-btn" id="btnOL" title="有序列表" aria-label="有序列表">1.</button>' +
                        '</div>' +
                        '<div class="toolbar-group">' +
                            '<div class="color-picker-wrapper" title="字体颜色">' +
                                '<input type="color" id="fontColor" value="#333333" aria-label="文字颜色">' +
                            '</div>' +
                            '<button type="button" class="toolbar-btn" id="btnClear" title="清除格式" aria-label="清除格式">🧹</button>' +
                        '</div>' +
                        '<div class="toolbar-group">' +
                            '<button type="button" class="toolbar-btn" id="btnLetterSpacing" title="字距" aria-label="调整字距">↔</button>' +
                            '<button type="button" class="toolbar-btn" id="btnLineHeight" title="行距" aria-label="调整行距">↕</button>' +
                            '<button type="button" class="toolbar-btn" id="btnQuote" title="引用" aria-label="引用">❝</button>' +
                            '<button type="button" class="toolbar-btn" id="btnComment" title="注释" aria-label="注释">💬</button>' +
                            '<button type="button" class="toolbar-btn" id="btnCode" title="代码" aria-label="插入代码">&lt;/&gt;</button>' +
                            '<button type="button" class="toolbar-btn" id="btnTable" title="插入表格" aria-label="插入表格">⊞</button>' +
                            '<button type="button" class="toolbar-btn" id="btnLink" title="链接" aria-label="插入链接">🔗</button>' +
                        '</div>' +
                        '<div class="toolbar-group">' +
                            '<button type="button" class="toolbar-btn" id="btnImage" title="图片" aria-label="插入图片">🖼️</button>' +
                            '<button type="button" class="toolbar-btn" id="btnVideo" title="视频" aria-label="插入视频">🎬</button>' +
                            '<button type="button" class="toolbar-btn" id="btnAudio" title="语音" aria-label="插入音频">🎙️</button>' +
                            '<button type="button" class="toolbar-btn" id="btnFile" title="文件" aria-label="插入文件">📌</button>' +
                        '</div>' +
                        '<div class="toolbar-group">' +
                            '<button type="button" class="toolbar-btn" id="btnEmoji" title="表情符号" aria-label="插入表情">😊</button>' +
                            '<button type="button" class="toolbar-btn" id="btnKaomoji" title="颜文字" aria-label="插入颜文字">^ω^</button>' +
                            '<button type="button" class="toolbar-btn" id="btnShape" title="插入形状" aria-label="插入形状">⬜</button>' +
                        '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                
                '<div class="editor-content" id="noteContent" contenteditable="true" aria-label="笔记正文" role="textbox" aria-multiline="true">' + sanitizeNoteHtml(content) + '</div>' +
            '</div>';

        bindEditorEvents(notebookId);
        initStickyObserver();
    }

    function initStickyObserver() {
        var container = document.getElementById('stickyContainer');
        if (!container) return;

        var observer = new IntersectionObserver(
            function(entries) {
                entries.forEach(function(entry) {
                    if (!entry.isIntersecting) {
                        container.classList.add('is-sticky');
                    } else {
                        container.classList.remove('is-sticky');
                    }
                });
            },
            { threshold: [1.0] }
        );

        observer.observe(container);
    }

    function createHiddenInput(id, accept, changeHandler) {
        var existing = document.getElementById(id);
        if (existing) {
            hiddenInputs[id.replace('Input', '')] = existing;
            return;
        }
        var input = document.createElement('input');
        input.type = 'file';
        input.id = id;
        input.accept = accept;
        input.style.display = 'none';
        input.addEventListener('change', changeHandler);
        document.body.appendChild(input);
        hiddenInputs[id.replace('Input', '')] = input;
    }

    function bindEditorEvents(notebookId) {
        document.getElementById('saveNoteBtn').addEventListener('click', saveNote);
        document.getElementById('cancelNoteBtn').addEventListener('click', function() {
            loadNotes(notebookId);
        });
        document.getElementById('shareNoteBtn').addEventListener('click', shareNoteAsPDF);

        var toolbarMore = document.getElementById('toolbarMoreBtn');
        var toolbarCollapsible = document.getElementById('toolbarCollapsible');
        if (toolbarMore && toolbarCollapsible) {
            toolbarMore.addEventListener('click', function() {
                var open = toolbarCollapsible.classList.toggle('is-open');
                toolbarMore.setAttribute('aria-expanded', open ? 'true' : 'false');
            });
        }

        // 【保留】撤销重做
        document.getElementById('btnUndo').addEventListener('click', function() { execCmd('undo'); });
        document.getElementById('btnRedo').addEventListener('click', function() { execCmd('redo'); });

        // 【保留并优化】字体处理：确保聚焦并处理空选区
        document.getElementById('fontFamily').addEventListener('change', function() {
            var editor = document.getElementById('noteContent');
            editor.focus();
            var selectedText = window.getSelection().toString();
            if (!selectedText) {
                // 如果没有选中文本，尝试获取当前段落或插入点
                execCmd('fontName', this.value);
            } else {
                execCmd('fontName', this.value);
            }
            editor.focus();
        });
        
        document.getElementById('fontSize').addEventListener('change', function(e) {
            var editor = document.getElementById('noteContent');
            editor.focus();
            document.execCommand('fontSize', false, e.target.value);
            editor.focus();
        });

        document.getElementById('btnBold').addEventListener('click', function() { execCmd('bold'); });
        document.getElementById('btnItalic').addEventListener('click', function() { execCmd('italic'); });
        document.getElementById('btnUnderline').addEventListener('click', function() { execCmd('underline'); });
        /* 删除线事件已移除 */
        
        document.getElementById('btnLeft').addEventListener('click', function() { execCmd('justifyLeft'); });
        document.getElementById('btnCenter').addEventListener('click', function() { execCmd('justifyCenter'); });
        document.getElementById('btnRight').addEventListener('click', function() { execCmd('justifyRight'); });
        
        document.getElementById('btnUL').addEventListener('click', function() { execCmd('insertUnorderedList'); });
        document.getElementById('btnOL').addEventListener('click', function() { execCmd('insertOrderedList'); });
        
        document.getElementById('btnQuote').addEventListener('click', function() {
            toggleBlockquote();
        });
         document.getElementById('btnComment').addEventListener('click', function() {
            insertCommentBox();
        });
        document.getElementById('btnCode').addEventListener('click', function() {
            insertCodeBlock();
        });

        document.getElementById('btnTable').addEventListener('click', function() {
            var rows = prompt("请输入行数 (默认 3):", "3");
            var cols = prompt("请输入列数 (默认 3):", "3");
            rows = parseInt(rows) || 3;
            cols = parseInt(cols) || 3;
            if (rows < 1 || cols < 1) { showToast("行列数必须大于 0", "error"); return; }

            var table = document.createElement('table');
            var tbody = document.createElement('tbody');
            for (var i = 0; i < rows; i++) {
                var tr = document.createElement('tr');
                for (var j = 0; j < cols; j++) {
                    var td = document.createElement(i === 0 ? 'th' : 'td');
                    td.contentEditable = "true";
                    td.innerHTML = i === 0 && j === 0 ? "表头" : (i === 0 ? "标题" : "内容");
                    tr.appendChild(td);
                }
                tbody.appendChild(tr);
            }
            table.appendChild(tbody);
            insertNodeAtCursor(table);
        });

        document.getElementById('fontColor').addEventListener('change', function() {
            execCmd('foreColor', this.value);
        });
        document.getElementById('btnClear').addEventListener('click', function() {
            execCmd('removeFormat');
        });

        document.getElementById('btnLink').addEventListener('click', function() {
            insertStyledLink();
        });

        document.getElementById('btnImage').addEventListener('click', function() {
            hiddenInputs['image'].click();
        });
        document.getElementById('btnVideo').addEventListener('click', function() {
            hiddenInputs['video'].click();
        });
        document.getElementById('btnAudio').addEventListener('click', function() {
            hiddenInputs['audio'].click();
        });
        document.getElementById('btnFile').addEventListener('click', function() {
            hiddenInputs['file'].click();
        });

        document.getElementById('btnEmoji').addEventListener('click', function() {
            togglePanel(this, 'emoji', [
                '😀', '😂', '😍', '🥰', '😎', '🤩', '🥳', '😭', 
                '😡', '🤯', '🥶', '😱', '🤠', '🥴', '😅', '🤮',
                '💫', '💖', '✨', '⭐', '🎉', '🔥', '💥', '🎁',
                '💦', '💣', '💯', '💢', '💤', '🔍', '🖊️', '🕳️',
                '📂', '📢', '🚀', '💡', '💻', '📖', '⚠️', '🔔'
            ]);
        });

        document.getElementById('btnKaomoji').addEventListener('click', function() {
            togglePanel(this, 'kaomoji', [
                '(≧∇≦)', '(^_^)', '(T_T)', '(>_<)', 'ꉂ೭(˵¯̴͒ꇴ¯̴͒˵)౨”', '(O_O)', 
                '(⑉･̆-･̆⑉)', 'o(´^｀)o', '(•̤̀ᵕ•̤́๑)ᵒᵏᵎᵎᵎ', '(*^ω^*)', '(´▽`ʃ♡ƪ)', 
                '(╯°□°）╯', '(•̀⌓• )', '⁽⁽ଘ( ˊᵕˋ )ଓ⁾⁾', '(｡•̀ᴗ-)✧', 
                '(੭ˊᵕˋ)੭', 'Ծ‸Ծ', '₍ᐢ..ᐢ₎', 'ʕ •ᴥ•ʔ', '(づ｡◕‿‿◕｡) づ'
            ], true);
        });

        document.getElementById('btnShape').addEventListener('click', function() {
            togglePanel(this, 'shape', [
                { s: '✧', d: '特殊' }, { s: '○', d: '圆形' }, 
                { s: '△', d: '三角' }, { s: '◇', d: '菱形' },
                { s: '◆', d: '实菱' }, { s: '●', d: '实圆' },
                { s: '■', d: '实方' }, { s: '□', d: '空方' },
                { s: '★', d: '五星' }, { s: '❤', d: '爱心' },
                { s: '✔', d: '对勾' }, { s: '✖', d: '叉叉' },
                { s: '↘', d: '箭头' }, { s: '↗', d: '箭头' }
            ], false, true);
        });

        document.getElementById('btnLetterSpacing').addEventListener('click', function() {
            adjustLetterSpacing();
        });
        document.getElementById('btnLineHeight').addEventListener('click', function() {
            adjustLineHeight();
        });

        /* 首行缩进事件已移除 */

    }

    function toggleBlockquote() {
        var btn = document.getElementById('btnQuote');
        var selection = window.getSelection();
        if (!selection.rangeCount) return;

        var node = selection.anchorNode;
        while (node && node.nodeType !== Node.ELEMENT_NODE) {
            node = node.parentNode;
        }

        var isInBlockquote = node && node.closest('blockquote');

        if (isInBlockquote) {
            document.execCommand('formatBlock', false, 'p');
        } else {
            document.execCommand('formatBlock', false, 'blockquote');
        }
        
        document.getElementById('noteContent').focus();
    }

    function insertCommentBox() {
        var content = document.getElementById('noteContent');
        content.focus();
        
        var selection = window.getSelection();
        if (!selection.rangeCount) return;

        var range = selection.getRangeAt(0);
        range.deleteContents();

        var wrapper = document.createElement('span');
        wrapper.className = 'comment-box';
        wrapper.contentEditable = "true";
        
        wrapper.innerHTML = ''; 
        var prefix = document.createTextNode('<!*');
        var suffix = document.createTextNode(' *->');
        var space = document.createTextNode('\u00A0'); 

        wrapper.appendChild(prefix);
        wrapper.appendChild(space);
        wrapper.appendChild(suffix);

        range.insertNode(wrapper);

        var newRange = document.createRange();
        newRange.setStart(space, 1);
        newRange.setEnd(space, 1);
        
        selection.removeAllRanges();
        selection.addRange(newRange);
    }

    function insertCodeBlock() {
        var code = prompt("请输入代码内容：", "");
        if (!code) return;

        var pre = document.createElement('pre');
        var codeEl = document.createElement('code');
        codeEl.textContent = code;
        pre.appendChild(codeEl);
        insertNodeAtCursor(pre);
    }

    function insertStyledLink() {
        var url = prompt('请输入链接地址:', '');
        if (!url) return;
        
        var text = prompt('请输入显示文本:', url);
        if (!text) text = url;

        var a = document.createElement('a');
        a.href = url;
        a.textContent = text;
        a.target = '_blank';
        a.style.textDecoration = 'none';
        a.style.color = '#4b6cb7';

        insertNodeAtCursor(a);
    }

    function adjustLetterSpacing() {
        var spacing = prompt("请输入字间距 (单位: px ):", "1.6");
        if (!spacing) return;
        
        var selection = window.getSelection();
        if (!selection.rangeCount) return;

        var node = selection.anchorNode;
        while (node && node.nodeType !== Node.ELEMENT_NODE) {
            node = node.parentNode;
        }
        if (node && node.nodeType === Node.ELEMENT_NODE) {
            node.style.letterSpacing = spacing + 'px';
        }
    }

    function adjustLineHeight() {
        var lineHeight = prompt("请输入行高倍数:", "1.8");
        if (!lineHeight) return;
        
        var selection = window.getSelection();
        if (!selection.rangeCount) return;

        var node = selection.anchorNode;
        while (node && node.nodeType !== Node.ELEMENT_NODE) {
            node = node.parentNode;
        }
        if (node && node.nodeType === Node.ELEMENT_NODE) {
            node.style.lineHeight = lineHeight;
        }
    }

    function handleFileSelect(e) {
        var file = e.target.files[0];
        var type = e.target.id.replace('Input', '');
        
        if (!file) return;
        
        if (file.size > 10 * 1024 * 1024) {
            showToast('文件过大，限制为 10MB', 'error');
            e.target.value = '';
            return;
        }

        if (type === 'file') {
            insertFileByObjectURL(file);
        } else {
            var reader = new FileReader();
            reader.onload = function(event) {
                var base64 = event.target.result;
                insertMediaByBase64(type, base64, file.name);
                e.target.value = '';
            };
            reader.onerror = function() {
                showToast('文件读取失败', 'error');
            }
            reader.readAsDataURL(file);
        }
    }

    function insertFileByObjectURL(file) {
        var objectUrl = URL.createObjectURL(file);
        var displayName = file.name || '本地文件';
        
        var card = document.createElement('div');
        card.className = 'file-card';
        card.contentEditable = "false";
        card.setAttribute('data-file-url', objectUrl);
        card.setAttribute('data-file-name', displayName);
        card.setAttribute('data-file-remark', '');
        
        card.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            openFileEditModal(this);
        });

        var innerHTML = 
            '<div class="file-card-inner">' +
                '<span class="file-icon">📌</span>' +
                '<div class="file-info">' +
                    '<div class="file-name">' + escapeHtml(displayName) + '</div>' +
                    '<div class="file-remark"></div>' +
                    '<div class="file-hint">点击修改名称或备注</div>' +
                '</div>' +
            '</div>' +
            '<a href="' + objectUrl + '" download="' + escapeHtml(displayName) + '" style="display:none;" class="file-download-link"></a>';
        
        card.innerHTML = innerHTML;
        
        insertNodeAtCursor(card);
    }

    function openFileEditModal(card) {
        appState.editingFileCard = card;
        var name = card.getAttribute('data-file-name') || '';
        var remark = card.getAttribute('data-file-remark') || '';
        
        document.getElementById('fileEditName').value = name;
        document.getElementById('fileEditRemark').value = remark;
        
        showModal('fileEdit', { focusSelector: '#fileEditName' });
    }

    function openCurrentFile() {
        if (!appState.editingFileCard) return;
        
        var url = appState.editingFileCard.getAttribute('data-file-url');
        var name = appState.editingFileCard.getAttribute('data-file-name') || 'file';
        
        if (!url) {
            showToast('文件链接已失效（可能已刷新页面）', 'error');
            return;
        }
        
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        showToast('正在打开/下载文件...', 'info');
    }

    function saveFileEdit() {
        if (!appState.editingFileCard) return;
        
        var newName = document.getElementById('fileEditName').value.trim();
        var newRemark = document.getElementById('fileEditRemark').value.trim();
        
        if (!newName) {
            showToast('文件名不能为空', 'error');
            return;
        }
        
        var card = appState.editingFileCard;
        card.setAttribute('data-file-name', newName);
        card.setAttribute('data-file-remark', newRemark);
        
        var nameEl = card.querySelector('.file-name');
        var remarkEl = card.querySelector('.file-remark');
        var linkEl = card.querySelector('.file-download-link');
        
        nameEl.textContent = newName;
        remarkEl.textContent = newRemark;
        
        if (linkEl) {
            linkEl.setAttribute('download', newName);
        }
        
        hideModal('fileEdit');
        showToast('修改成功', 'success');
        appState.editingFileCard = null;
    }

    function insertMediaByBase64(type, base64, fileName) {
        if (type === 'image') {
            var img = document.createElement('img');
            img.src = base64;
            img.style.maxWidth = '100%';
            // 【优化】添加懒加载属性
            img.setAttribute('loading', 'lazy');
            insertNodeAtCursor(img);
        } else if (type === 'video') {
            var video = document.createElement('video');
            video.src = base64;
            video.controls = true;
            video.style.maxWidth = '100%';
            insertNodeAtCursor(video);
        } else if (type === 'audio') {
            var audio = document.createElement('audio');
            audio.src = base64;
            audio.controls = true;
            audio.style.maxWidth = '100%';
            insertNodeAtCursor(audio);
        }
    }

    function execCmd(command, value) {
        document.execCommand(command, false, value);
        document.getElementById('noteContent').focus();
    }

    function insertNodeAtCursor(node) {
        var content = document.getElementById('noteContent');
        content.focus();
        var selection = window.getSelection();
        if (selection.rangeCount > 0) {
            var range = selection.getRangeAt(0);
            range.deleteContents();
            range.insertNode(node);
            
            range.setStartAfter(node);
            range.setEndAfter(node);
            selection.removeAllRanges();
            selection.addRange(range);
        } else {
            content.appendChild(node);
        }
    }

    function togglePanel(button, type, items, isText, isObject) {
        var existing = document.querySelector('.' + type + '-panel');
        
        if (existing) { 
            document.body.removeChild(existing); 
            return; 
        }

        var panel = document.createElement('div');
        panel.className = 'popup-panel ' + type + '-panel';
        
        items.forEach(function(item) {
            var btn = document.createElement('button');
            btn.className = isText ? 'panel-btn kaomoji-btn' : 'panel-btn';
            
            var displayVal = isObject ? item.s : item;
            var insertVal = isObject ? item.s : item;
            
            btn.textContent = displayVal;
            if (!isText && isObject) btn.title = item.d;

            btn.addEventListener('click', function() {
                if (isText) {
                    insertNodeAtCursor(document.createTextNode(insertVal));
                } else {
                    insertNodeAtCursor(document.createTextNode(insertVal));
                }
                if(document.body.contains(panel)) document.body.removeChild(panel);
            });
            panel.appendChild(btn);
        });

        document.body.appendChild(panel);
        
        var rect = button.getBoundingClientRect();
        var top = rect.bottom + 5;
        var left = rect.left;
        
        if (left + panel.offsetWidth > window.innerWidth) {
            left = window.innerWidth - panel.offsetWidth - 10;
        }
        
        panel.style.top = top + 'px';
        panel.style.left = left + 'px';

        setTimeout(function() {
            document.addEventListener('click', function close(e) {
                if (!panel.contains(e.target) && e.target !== button) {
                    if(document.body.contains(panel)) document.body.removeChild(panel);
                    document.removeEventListener('click', close);
                }
            });
        }, 10);
    }

    function loadHtml2Pdf() {
        return new Promise(function(resolve, reject) {
            if (typeof html2pdf !== 'undefined') {
                resolve();
                return;
            }
            var pending = document.querySelector('script[data-html2pdf]');
            if (pending) {
                pending.addEventListener('load', function() { resolve(); });
                pending.addEventListener('error', function() { reject(new Error('load')); });
                return;
            }
            var s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
            s.async = true;
            s.setAttribute('data-html2pdf', '1');
            s.onload = function() { resolve(); };
            s.onerror = function() { reject(new Error('load')); };
            document.head.appendChild(s);
        });
    }

    function shareNoteAsPDF() {
        var titleText = document.getElementById('noteTitle').value.trim() || '无标题';
        var contentDiv = document.getElementById('noteContent');
        
        if (!contentDiv.innerText.trim()) {
            showToast('笔记内容为空，无法生成 PDF', 'error');
            return;
        }

        showToast('正在生成 PDF，请稍候...', 'loading');

        var cloneContainer = document.createElement('div');
        cloneContainer.style.padding = '0';
        cloneContainer.style.fontFamily = '"STKaiti", "KaiTi", serif';
        
        var titleEl = document.createElement('h1');
        titleEl.textContent = titleText;
        titleEl.style.fontSize = '24px';
        titleEl.style.color = '#8B4513';
        titleEl.style.margin = '0 0 20px 0';
        titleEl.style.textAlign = 'center';
        titleEl.style.borderBottom = '2px solid #d2b48c';
        titleEl.style.paddingBottom = '10px';
        cloneContainer.appendChild(titleEl);

        var contentClone = contentDiv.cloneNode(true);
        contentClone.style.border = 'none';
        contentClone.style.padding = '0';
        contentClone.style.background = 'transparent';
        contentClone.style.marginTop = '0';
        
        cloneContainer.appendChild(contentClone);

        var opt = {
            margin:       [15, 15, 15, 15],
            filename:     titleText.replace(/[\\/:*?"<>|]/g, '') + '.pdf',
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2, useCORS: true, letterRendering: true },
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        loadHtml2Pdf().then(function() {
            return html2pdf().set(opt).from(cloneContainer).save();
        }).then(function() {
            showToast('PDF 下载成功！', 'success');
        }).catch(function(err) {
            console.error(err);
            showToast(err && err.message === 'load' ? '无法加载 PDF 模块，请检查网络' : '生成 PDF 失败', 'error');
        });
    }

    function saveNote() {
        if (!appState.supabase) return;
        var title = document.getElementById('noteTitle').value.trim() || '无标题';
        var content = sanitizeNoteHtml(document.getElementById('noteContent').innerHTML);
        var btn = document.getElementById('saveNoteBtn');

        if (!content.trim() || content === '<br>') {
            showToast('内容不能为空', 'error');
            return;
        }

        btn.disabled = true;
        btn.textContent = '保存中...';
        debug('保存笔记，标题:' + title);

        var promise;
        if (appState.currentNoteId) {
            promise = appState.supabase
                .from('notes')
                .update({ title: title, content: content, updated_at: new Date().toISOString() })
                .eq('id', appState.currentNoteId)
                .eq('user_id', appState.currentUser.id);
        } else {
            promise = appState.supabase
                .from('notes')
                .insert([{
                    title: title,
                    content: content,
                    notebook_id: appState.currentNotebookId,
                    user_id: appState.currentUser.id
                }]);
        }

        promise.then(function(result) {
            if (result.error) throw result.error;
            showToast(appState.currentNoteId ? '更新成功' : '创建成功', 'success');
            loadNotes(appState.currentNotebookId);
        }).catch(function(err) {
            debug('保存失败:' + err.message);
            showToast('保存失败：' + getFriendlyError(err.message), 'error');
        }).finally(function() {
            btn.disabled = false;
            btn.textContent = '保存墨宝';
        });
    }

    function deleteNote(noteId) {
        if (!confirm('确定删除此笔记？此操作不可恢复。')) return;
        if (!appState.supabase) return;
        appState.supabase
            .from('notes')
            .delete()
            .eq('id', noteId)
            .eq('user_id', appState.currentUser.id)
            .then(function(result) {
                if (result.error) throw result.error;
                showToast('删除成功', 'success');
                loadNotes(appState.currentNotebookId);
            }).catch(function(err) {
                showToast('删除失败', 'error');
            });
    }

    function editNotebook(notebookId, oldName) {
        var newName = prompt('修改笔记集名称:', oldName);
        if (!newName || newName === oldName) return;
        
        var notebooks = document.querySelectorAll('.notebook-item');
        for(var i = 0; i < notebooks.length; i++) {
            var existingName = notebooks[i].querySelector('.notebook-name').textContent;
            if(existingName === newName && notebooks[i].getAttribute('data-id') !== notebookId.toString()) {
                showToast('笔记集名称已存在，请选择其他名称', 'error');
                return;
            }
        }
        
        appState.supabase
            .from('notebooks')
            .update({ name: newName, updated_at: new Date().toISOString() })
            .eq('id', notebookId)
            .eq('user_id', appState.currentUser.id)
            .then(function(result) {
                if (result.error) throw result.error;
                showToast('修改成功', 'success');
                loadNotebooks();
            }).catch(function(err) {
                showToast('修改失败', 'error');
            });
    }

    function deleteNotebook(notebookId) {
        if (!confirm('确定删除？此操作将删除该笔记集下所有笔记！')) return;
        if (!appState.supabase) return;
        appState.supabase
            .from('notes')
            .delete()
            .eq('notebook_id', notebookId)
            .eq('user_id', appState.currentUser.id)
            .then(function() {
                return appState.supabase
                    .from('notebooks')
                    .delete()
                    .eq('id', notebookId)
                    .eq('user_id', appState.currentUser.id);
            }).then(function(result) {
                if (result.error) throw result.error;
                if (appState.currentNotebookId === notebookId) {
                    appState.currentNotebookId = null;
                    clearContent();
                }
                showToast('删除成功', 'success');
                loadNotebooks();
            }).catch(function(err) {
                showToast('删除失败', 'error');
            });
    }

    function clearContent() {
        document.getElementById('contentArea').innerHTML = 
            '<div class="empty-state">' +
            '<h3>请选择或创建笔记集</h3>' +
            '<p>登录后即可开始创作</p>' +
            '</div>';
    }

    function bindEvents() {
        document.getElementById('userActions').addEventListener('click', function(e) {
            if (e.target && e.target.id === 'cursorPrefBtn') {
                e.preventDefault();
                toggleCursorPreference();
            }
        });

        document.getElementById('loginBtn').addEventListener('click', function() { showModal('login'); });
        document.getElementById('registerBtn').addEventListener('click', function() { showModal('register'); });
        document.getElementById('createNotebookBtn').addEventListener('click', createNotebook);
        document.getElementById('newNotebookName').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') createNotebook();
        });
        document.getElementById('loginPassword').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') handleLogin();
        });
        document.getElementById('registerConfirmPassword').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') handleRegister();
        });
        document.getElementById('closeLoginBtn').addEventListener('click', function() { hideModal('login'); });
        document.getElementById('closeRegisterBtn').addEventListener('click', function() { hideModal('register'); });
        document.getElementById('cancelLoginBtn').addEventListener('click', function() { hideModal('login'); });
        document.getElementById('cancelRegisterBtn').addEventListener('click', function() { hideModal('register'); });
        document.getElementById('toRegisterLink').addEventListener('click', function(e) {
            e.preventDefault();
            switchModal('login', 'register');
        });
        document.getElementById('toLoginLink').addEventListener('click', function(e) {
            e.preventDefault();
            switchModal('register', 'login');
        });
        document.getElementById('doLoginBtn').addEventListener('click', handleLogin);
        document.getElementById('doRegisterBtn').addEventListener('click', handleRegister);

        document.getElementById('closeFileEditBtn').addEventListener('click', function() { hideModal('fileEdit'); });
        document.getElementById('cancelFileEditBtn').addEventListener('click', function() { hideModal('fileEdit'); });
        document.getElementById('saveFileEditBtn').addEventListener('click', saveFileEdit);
        document.getElementById('openFileBtn').addEventListener('click', openCurrentFile);

        document.addEventListener('keydown', function globalEditorHotkeys(e) {
            var noteContent = document.getElementById('noteContent');
            if (!noteContent) return;
            if (e.key === 'Delete' || e.key === 'Backspace') {
                var selectedMedia = document.querySelector('#noteContent video.selected, #noteContent audio.selected');
                if (selectedMedia) {
                    e.preventDefault();
                    selectedMedia.remove();
                }
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                if (e.shiftKey) {
                    execCmd('redo');
                } else {
                    execCmd('undo');
                }
            }
        });

        document.addEventListener('click', function globalNoteContentMediaClick(e) {
            var editor = document.getElementById('noteContent');
            if (!editor || !editor.contains(e.target)) return;
            var selectedMedia = editor.querySelectorAll('video.selected, audio.selected');
            selectedMedia.forEach(function(el) {
                el.classList.remove('selected');
            });
            if (e.target.tagName === 'VIDEO' || e.target.tagName === 'AUDIO') {
                e.target.classList.add('selected');
            }
        });

        document.querySelectorAll('.modal-overlay').forEach(function(overlay) {
            overlay.addEventListener('click', function(e) {
                if (e.target === overlay) {
                    var type = overlay.id.replace(/Modal$/, '');
                    hideModal(type);
                }
            });
        });
    }

    function init() {
        applyCursorPreference();
        initCursorPrefUi();
        debug('=== 应用初始化开始 ===');
        if (typeof window.supabase === 'undefined') {
            debug('Supabase SDK 未加载');
            showToast('系统加载失败，请刷新页面', 'error');
            return;
        }
        appState.supabase = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
        debug('Supabase 客户端初始化成功');
        bindEvents();
        checkAuth();
        debug('=== 应用初始化完成 ===');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
