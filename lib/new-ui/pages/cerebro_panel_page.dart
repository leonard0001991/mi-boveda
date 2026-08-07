import 'package:cake_wallet/core/cerebro_admin_service.dart';
import 'package:cake_wallet/new-ui/widgets/modal_page_wrapper.dart';
import 'package:cake_wallet/new-ui/widgets/receive_page/receive_top_bar.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';

String _fmtNum(double n) {
  final s = n.toStringAsFixed(8);
  final trimmed = s.replaceFirst(RegExp(r'0+$'), '').replaceFirst(RegExp(r'\.$'), '');
  return trimmed == '-0' ? '0' : trimmed;
}

String _fmtDate(String iso) {
  if (iso.isEmpty) return '—';
  try {
    final dt = DateTime.parse(iso).toLocal();
    return DateFormat('dd/MM HH:mm').format(dt);
  } catch (_) {
    return iso;
  }
}

class CerebroPanelPage extends StatefulWidget {
  const CerebroPanelPage({super.key, required this.cerebroAdminService});

  final CerebroAdminService cerebroAdminService;

  @override
  State<CerebroPanelPage> createState() => _CerebroPanelPageState();
}

class _CerebroPanelPageState extends State<CerebroPanelPage> {
  bool _loading = true;
  String? _error;
  bool? _erleoEnabled;
  List<CerebroOrder> _pending = [];
  List<CerebroOrder> _approved = [];
  List<CerebroOrder> _history = [];
  List<CerebroReserve> _reserves = [];
  CerebroReportTotals? _reportTotals;
  bool _apiKeyShown = false;
  String? _apiKey;

  bool get _needsLogin =>
      !widget.cerebroAdminService.hasSavedPassword ||
      (_error?.contains('Sin sesión') ?? false) ||
      (_error?.contains('Contraseña') ?? false);

  @override
  void initState() {
    super.initState();
    _loadAll();
  }

  Future<void> _loadAll() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final enabled = await widget.cerebroAdminService.isErleoEnabled();
      final pending = await widget.cerebroAdminService.pendingOrders();
      final approved = await widget.cerebroAdminService.approvedOrders();
      final history = await widget.cerebroAdminService.history();
      final reserves = await widget.cerebroAdminService.reserves();
      final report = await widget.cerebroAdminService.commissionReport();
      final apiKeyInfo = await widget.cerebroAdminService.apiKeyInfo();
      if (!mounted) return;
      setState(() {
        _erleoEnabled = enabled;
        _pending = pending;
        _approved = approved;
        _history = history;
        _reserves = reserves;
        _reportTotals = report.totals;
        _apiKey = apiKeyInfo.apiKey;
        _apiKeyShown = apiKeyInfo.revealedOnce;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _login(String password) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await widget.cerebroAdminService.login(password);
      await _loadAll();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _toggle() async {
    final target = !(_erleoEnabled ?? false);
    try {
      final enabled = await widget.cerebroAdminService.setErleoEnabled(target);
      if (!mounted) return;
      setState(() {
        _erleoEnabled = enabled;
      });
      _snack(enabled
          ? 'Intercambios Erleo ACTIVADOS'
          : 'Intercambios Erleo DETENIDOS');
    } catch (e) {
      _showError(e);
    }
  }

  Future<void> _approve(CerebroOrder o) async {
    try {
      await widget.cerebroAdminService.approveOrder(o.id);
      _snack('Orden ${o.id.substring(0, 6)} aprobada');
      await _loadAll();
    } catch (e) {
      _showError(e);
    }
  }

  Future<void> _reject(CerebroOrder o) async {
    final ok = await _confirm('Rechazar', '¿Rechazar la orden ${o.id.substring(0, 6)}? El usuario verá el mensaje del mínimo oficial.');
    if (!ok) return;
    try {
      await widget.cerebroAdminService.rejectOrder(o.id);
      _snack('Orden ${o.id.substring(0, 6)} rechazada');
      await _loadAll();
    } catch (e) {
      _showError(e);
    }
  }

  Future<void> _complete(CerebroOrder o) async {
    final txp = await _askText('Hash de envío al usuario (opcional)');
    if (txp == null) return;
    final txr = await _askText('Hash de recepción del usuario (opcional)');
    if (txr == null) return;
    try {
      await widget.cerebroAdminService.completeOrder(o.id,
          txHashPayout: txp, txHashRefund: txr);
      _snack('Orden ${o.id.substring(0, 6)} completada');
      await _loadAll();
    } catch (e) {
      _showError(e);
    }
  }

  Future<void> _addReserve() async {
    final symbol = await _askText('Moneda (ej. XNO, BTC)');
    if (symbol == null || symbol.trim().isEmpty) return;
    final address = await _askText('Dirección de reserva (envío)');
    if (address == null || address.trim().isEmpty) return;
    final receive = await _askText('Dirección donde RECIBES del usuario (opcional)');
    if (receive == null) return;
    final payout = await _askText('Dirección desde la que ENVÍAS (opcional)');
    if (payout == null) return;
    try {
      await widget.cerebroAdminService.saveReserve(
        symbol: symbol.trim().toUpperCase(),
        address: address.trim(),
        receiveAddress: receive.trim(),
        payoutAddress: payout.trim(),
      );
      _snack('Reserva guardada');
      await _loadAll();
    } catch (e) {
      _showError(e);
    }
  }

  Future<void> _deleteReserve(CerebroReserve r) async {
    final ok = await _confirm('Eliminar', '¿Eliminar la reserva de ${r.symbol}?');
    if (!ok) return;
    try {
      await widget.cerebroAdminService.deleteReserve(r.symbol);
      _snack('Reserva eliminada');
      await _loadAll();
    } catch (e) {
      _showError(e);
    }
  }

  Future<void> _showApiKey() async {
    if (_apiKeyShown) return;
    try {
      await widget.cerebroAdminService.markApiKeyShown();
      if (!mounted) return;
      setState(() => _apiKeyShown = true);
      _snack('Clave marcada como vista (no se volverá a mostrar completa).');
    } catch (e) {
      _showError(e);
    }
  }

  void _snack(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(msg), duration: const Duration(seconds: 3)));
  }

  void _showError(Object e) {
    if (!mounted) return;
    final msg = e.toString();
    setState(() {
      _error = msg;
      if (msg.contains('401') || msg.contains('Sin sesión') || msg.contains('Contraseña')) {
        widget.cerebroAdminService.logout();
      }
    });
    _snack(msg);
  }

  Future<bool> _confirm(String title, String body) async {
    final res = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: Text(body),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Confirmar')),
        ],
      ),
    );
    return res ?? false;
  }

  Future<String?> _askText(String title) async {
    final controller = TextEditingController();
    final res = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: TextField(controller: controller, autofocus: true),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, null), child: const Text('Cancelar')),
          TextButton(
              onPressed: () => Navigator.pop(ctx, controller.text), child: const Text('OK')),
        ],
      ),
    );
    return res;
  }

  @override
  Widget build(BuildContext context) {
    if (_needsLogin) {
      return _LoginView(loading: _loading, error: _error, onLogin: _login);
    }
    return ModalPageWrapper(
      topBar: ModalTopBar(
        title: 'Intercambios Erleo',
        leadingIcon: const Icon(Icons.arrow_back_ios_new),
        onLeadingPressed: () => Navigator.of(context).pop(),
        trailingIcon: IconButton(
          icon: const Icon(Icons.refresh),
          onPressed: _loading ? null : _loadAll,
        ),
      ),
      content: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return const Padding(
        padding: EdgeInsets.all(48),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    if (_error != null && !_needsLogin) {
      return Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Text('Error: $_error',
                style: const TextStyle(color: Colors.red, fontSize: 13)),
          ),
          ElevatedButton(onPressed: _loadAll, child: const Text('Reintentar')),
        ],
      );
    }
    return Column(
      children: [
        _buildToggleCard(),
        const SizedBox(height: 12),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.only(bottom: 24),
            children: [
              _buildSectionTitle('Órdenes pendientes (${_pending.length})'),
              ...(_pending.isEmpty
                  ? [_buildEmpty('No hay órdenes pendientes')]
                  : _pending.map(_buildOrderCard).toList()),
              _buildSectionTitle('Aprobadas (pendientes de envío)'),
              ...(_approved.isEmpty
                  ? [_buildEmpty('No hay órdenes aprobadas')]
                  : _approved.map(_buildApprovedCard).toList()),
              _buildSectionTitle('Historial'),
              ...(_history.isEmpty
                  ? [_buildEmpty('Sin historial todavía')]
                  : _history.map(_buildHistoryCard).toList()),
              _buildSectionTitle('Comisiones Erleo'),
              _buildReportCard(),
              _buildSectionTitle('Direcciones de reserva'),
              _buildReservesCard(),
              _buildSectionTitle('Clave API de la app'),
              _buildApiKeyCard(),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildToggleCard() {
    final enabled = _erleoEnabled ?? false;
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 4),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: enabled ? Colors.red.withAlpha(25) : Colors.green.withAlpha(25),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
            color: enabled ? Colors.red : Colors.green,
            width: 2),
      ),
      child: Column(
        children: [
          Text(
            enabled ? '🟢 Sistema ACTIVADO' : '🔴 Sistema DETENIDO',
            style: TextStyle(
                fontSize: 18, fontWeight: FontWeight.w700,
                color: enabled ? Colors.red : Colors.green),
          ),
          const SizedBox(height: 4),
          const Text('Con Erleo activo, las apps mandan aquí los montos por debajo del mínimo de ChangeNOW.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12)),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            height: 56,
            child: ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: enabled ? Colors.red : Colors.green,
                foregroundColor: Colors.white,
                textStyle: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
              ),
              onPressed: _loading ? null : _toggle,
              child: Text(enabled ? '🔴 Detener intercambios' : '🟢 Activar intercambios'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSectionTitle(String title) => Padding(
        padding: const EdgeInsets.only(top: 20, bottom: 8),
        child: Text(title,
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
      );

  Widget _buildEmpty(String msg) => Padding(
        padding: const EdgeInsets.all(12),
        child: Text(msg,
            style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
      );

  Widget _orderInfo(CerebroOrder o) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('${_fmtNum(o.fromAmount)} ${o.fromSymbol} → ${o.toSymbol}',
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
        const SizedBox(height: 2),
        Text('${_fmtDate(o.createdAt)} · ${o.speed}',
            style: TextStyle(
                fontSize: 12,
                color: Theme.of(context).colorScheme.onSurfaceVariant)),
        if (o.userLabel.isNotEmpty)
          Text('Usuario: ${o.userLabel}', style: const TextStyle(fontSize: 12)),
        Text('Destino: ${o.toAddress}', style: const TextStyle(fontSize: 12)),
        if (o.commissionUsd > 0)
          Text('Comisión: \$${o.commissionUsd.toStringAsFixed(2)} USD',
              style: const TextStyle(fontSize: 12)),
        if (o.netToAmount > 0)
          Text('Entrega: ${_fmtNum(o.netToAmount)} ${o.toSymbol}',
              style: const TextStyle(fontSize: 12)),
      ],
    );
  }

  Widget _buildOrderCard(CerebroOrder o) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _orderInfo(o),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: FilledButton(
                    style: FilledButton.styleFrom(backgroundColor: Colors.green),
                    onPressed: () => _approve(o),
                    child: const Text('✅ Aceptar'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton(
                    style: FilledButton.styleFrom(backgroundColor: Colors.red),
                    onPressed: () => _reject(o),
                    child: const Text('❌ Rechazar'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildApprovedCard(CerebroOrder o) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _orderInfo(o),
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton(
                onPressed: () => _complete(o),
                child: const Text('✔ Marcar completada'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHistoryCard(CerebroOrder o) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('${_fmtNum(o.fromAmount)} ${o.fromSymbol} → ${o.toSymbol} · ${o.status}',
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
            Text('${_fmtDate(o.createdAt)} · ${o.speed}',
                style: TextStyle(
                    fontSize: 12,
                    color: Theme.of(context).colorScheme.onSurfaceVariant)),
          ],
        ),
      ),
    );
  }

  Widget _buildReportCard() {
    final t = _reportTotals;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Expanded(
              child: _stat('Órdenes', '${t?.count ?? 0}'),
            ),
            Expanded(
              child: _stat('Total comisiones',
                  '\$${(t?.totalCommissionUsd ?? 0).toStringAsFixed(2)}'),
            ),
            Expanded(
              child: _stat('Ahorro fees',
                  '\$${(t?.totalProviderFeeSavedUsd ?? 0).toStringAsFixed(2)}'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _stat(String label, String value) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style: TextStyle(
                  fontSize: 11,
                  color: Theme.of(context).colorScheme.onSurfaceVariant)),
          const SizedBox(height: 2),
          Text(value,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
        ],
      );

  Widget _buildReservesCard() {
    return Column(
      children: [
        if (_reserves.isEmpty)
          _buildEmpty('No hay direcciones de reserva configuradas.')
        else
          ..._reserves.map((r) => Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  dense: true,
                  title: Text(r.symbol),
                  subtitle: Text('${r.address}\nRecibir: ${r.receiveAddress.isEmpty ? '—' : r.receiveAddress}\nEnviar: ${r.payoutAddress.isEmpty ? '—' : r.payoutAddress}'),
                  isThreeLine: true,
                  trailing: IconButton(
                    icon: const Icon(Icons.delete_outline),
                    onPressed: () => _deleteReserve(r),
                  ),
                ),
              )),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            onPressed: _addReserve,
            icon: const Icon(Icons.add),
            label: const Text('Añadir dirección de reserva'),
          ),
        ),
      ],
    );
  }

  Widget _buildApiKeyCard() {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Esta clave va en cada build de la app para que las apps se conecten a tu servidor.',
              style: TextStyle(fontSize: 12),
            ),
            const SizedBox(height: 8),
            if (_apiKeyShown)
              const Text('La clave ya fue revelada y no se vuelve a mostrar por seguridad.',
                  style: TextStyle(fontSize: 12))
            else if (_apiKey != null && _apiKey!.isNotEmpty) ...[
              SelectableText(_apiKey!,
                  style: const TextStyle(
                      fontFamily: 'monospace', fontSize: 12)),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: FilledButton(
                      onPressed: () {
                        Clipboard.setData(ClipboardData(text: _apiKey!));
                        _snack('Clave copiada');
                      },
                      child: const Text('📋 Copiar'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton(
                      onPressed: _showApiKey,
                      child: const Text('✅ Ya la guardé'),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _LoginView extends StatefulWidget {
  const _LoginView({required this.loading, required this.error, required this.onLogin});

  final bool loading;
  final String? error;
  final Future<void> Function(String password) onLogin;

  @override
  State<_LoginView> createState() => _LoginViewState();
}

class _LoginViewState extends State<_LoginView> {
  final _controller = TextEditingController();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Panel Erleo'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Introduce la contraseña de administrador del servidor.',
                textAlign: TextAlign.center),
            const SizedBox(height: 16),
            TextField(
              controller: _controller,
              obscureText: true,
              autofocus: true,
              decoration: const InputDecoration(
                labelText: 'Contraseña de administrador',
                border: OutlineInputBorder(),
              ),
            ),
            if (widget.error != null) ...[
              const SizedBox(height: 8),
              Text(widget.error!,
                  style: const TextStyle(color: Colors.red, fontSize: 13)),
            ],
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: widget.loading
                  ? null
                  : () => widget.onLogin(_controller.text),
              child: widget.loading
                  ? const SizedBox(
                      height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Entrar'),
            ),
          ],
        ),
      ),
    );
  }
}
