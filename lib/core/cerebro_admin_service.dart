import 'dart:async';
import 'dart:convert';

import 'package:cake_wallet/core/cerebro_service.dart';
import 'package:cake_wallet/entities/preferences_key.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class CerebroOrder {
  CerebroOrder({
    required this.id,
    required this.status,
    required this.fromSymbol,
    required this.fromNetwork,
    required this.fromAmount,
    required this.toSymbol,
    required this.toNetwork,
    required this.toAddress,
    required this.toExtraId,
    required this.speed,
    required this.commissionUsd,
    required this.netToAmount,
    required this.createdAt,
    this.userLabel = '',
    this.adminNote = '',
    this.completedAt,
    this.txHashPayout = '',
    this.txHashRefund = '',
  });

  final String id;
  final String status;
  final String fromSymbol;
  final String fromNetwork;
  final double fromAmount;
  final String toSymbol;
  final String toNetwork;
  final String toAddress;
  final String toExtraId;
  final String speed;
  final double commissionUsd;
  final double netToAmount;
  final String createdAt;
  final String userLabel;
  final String adminNote;
  final String? completedAt;
  final String txHashPayout;
  final String txHashRefund;

  factory CerebroOrder.fromJson(Map<String, dynamic> json) => CerebroOrder(
        id: json['id'] as String? ?? '',
        status: json['status'] as String? ?? 'pending',
        fromSymbol: json['fromSymbol'] as String? ?? '',
        fromNetwork: json['fromNetwork'] as String? ?? '',
        fromAmount: (json['fromAmount'] as num?)?.toDouble() ?? 0,
        toSymbol: json['toSymbol'] as String? ?? '',
        toNetwork: json['toNetwork'] as String? ?? '',
        toAddress: json['toAddress'] as String? ?? '',
        toExtraId: json['toExtraId'] as String? ?? '',
        speed: json['speed'] as String? ?? 'medium',
        commissionUsd: (json['commissionUsd'] as num?)?.toDouble() ?? 0,
        netToAmount: (json['netToAmount'] as num?)?.toDouble() ?? 0,
        createdAt: json['createdAt'] as String? ?? '',
        userLabel: json['userLabel'] as String? ?? '',
        adminNote: json['adminNote'] as String? ?? '',
        completedAt: json['completedAt'] as String?,
        txHashPayout: json['txHashPayout'] as String? ?? '',
        txHashRefund: json['txHashRefund'] as String? ?? '',
      );

  bool get isPending => status == 'pending';
  bool get isApproved => status == 'approved';
}

class CerebroReserve {
  CerebroReserve({
    required this.symbol,
    required this.network,
    required this.address,
    required this.receiveAddress,
    required this.payoutAddress,
    required this.enabled,
  });

  final String symbol;
  final String network;
  final String address;
  final String receiveAddress;
  final String payoutAddress;
  final bool enabled;

  factory CerebroReserve.fromJson(Map<String, dynamic> json) => CerebroReserve(
        symbol: json['symbol'] as String? ?? '',
        network: json['network'] as String? ?? '',
        address: json['address'] as String? ?? '',
        receiveAddress: json['receiveAddress'] as String? ?? '',
        payoutAddress: json['payoutAddress'] as String? ?? '',
        enabled: json['enabled'] == 1 || json['enabled'] == true,
      );
}

class CerebroReportTotals {
  CerebroReportTotals({
    required this.count,
    required this.totalCommissionUsd,
    required this.totalProviderFeeSavedUsd,
  });

  final int count;
  final double totalCommissionUsd;
  final double totalProviderFeeSavedUsd;

  factory CerebroReportTotals.fromJson(Map<String, dynamic> json) =>
      CerebroReportTotals(
        count: (json['count'] as num?)?.toInt() ?? 0,
        totalCommissionUsd: (json['totalCommissionUsd'] as num?)?.toDouble() ?? 0,
        totalProviderFeeSavedUsd:
            (json['totalProviderFeeSavedUsd'] as num?)?.toDouble() ?? 0,
      );
}

/// Cliente para las operaciones de ADMIN del Cerebro.
/// El panel dentro de la app habla con el servidor global; usa la contraseña
/// de administrador (la misma del panel web) y la API key del servidor.
class CerebroAdminService {
  CerebroAdminService(this._cerebroService, this._prefs);

  final CerebroService _cerebroService;
  final SharedPreferences _prefs;

  String get serverUrl => _cerebroService.serverUrl;
  String get apiKey => _cerebroService.apiKey;

  bool get hasSavedPassword =>
      (_prefs.getString(PreferencesKey.cerebroAdminPassword) ?? '').isNotEmpty;

  String? get savedToken => _prefs.getString(PreferencesKey.cerebroAdminToken);

  String get serverBase {
    final url = serverUrl;
    if (url.isEmpty) return '';
    return url.endsWith('/') ? url : '$url/';
  }

  bool get isConfigured => serverBase.isNotEmpty && apiKey.isNotEmpty;

  Map<String, String> _adminHeaders(String? token) => {
        'Content-Type': 'application/json',
        if (token != null && token.isNotEmpty) 'x-session-token': token,
      };

  /// Inicia sesión de administrador y guarda el token localmente.
  Future<String> login(String password) async {
    final res = await http
        .post(Uri.parse('${serverBase}api/v1/admin/login'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'password': password}))
        .timeout(const Duration(seconds: 12));
    if (res.statusCode != 200) {
      throw Exception('Contraseña incorrecta');
    }
    final json = jsonDecode(res.body) as Map<String, dynamic>;
    final token = json['token'] as String? ?? '';
    if (token.isEmpty) throw Exception('Login sin token');
    await _prefs.setString(PreferencesKey.cerebroAdminToken, token);
    await _prefs.setString(PreferencesKey.cerebroAdminPassword, password);
    return token;
  }

  String? _token() =>
      _prefs.getString(PreferencesKey.cerebroAdminToken) ?? savedToken;

  /// Asegura tener una sesión válida usando la contraseña guardada.
  Future<String> ensureSession() async {
    final token = _token();
    if (token != null && token.isNotEmpty) return token;
    final password = _prefs.getString(PreferencesKey.cerebroAdminPassword);
    if (password == null || password.isEmpty) {
      throw Exception('Sin sesión');
    }
    return login(password);
  }

  Future<Map<String, dynamic>> _adminGet(String path) async {
    final token = await ensureSession();
    final res = await http
        .get(Uri.parse('$serverBase$path'), headers: _adminHeaders(token))
        .timeout(const Duration(seconds: 12));
    if (res.statusCode == 401) {
      await _prefs.remove(PreferencesKey.cerebroAdminToken);
      final fresh = await ensureSession();
      return _adminGetRetry(path, fresh);
    }
    if (res.statusCode != 200) throw Exception('HTTP ${res.statusCode}');
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> _adminGetRetry(
      String path, String token) async {
    final res = await http
        .get(Uri.parse('$serverBase$path'), headers: _adminHeaders(token))
        .timeout(const Duration(seconds: 12));
    if (res.statusCode != 200) throw Exception('HTTP ${res.statusCode}');
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> _adminPost(
      String path, Map<String, dynamic>? body) async {
    final token = await ensureSession();
    final res = await http
        .post(Uri.parse('$serverBase$path'),
            headers: _adminHeaders(token),
            body: body == null ? '{}' : jsonEncode(body))
        .timeout(const Duration(seconds: 12));
    if (res.statusCode != 200) throw Exception('HTTP ${res.statusCode}');
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  // ============================================================
  // Toggle global (botón grande Activar / Detener)
  // ============================================================

  Future<bool> isErleoEnabled() async {
    if (!isConfigured) return false;
    try {
      final res = await http
          .get(Uri.parse('${serverBase}api/v1/settings/erleo-enabled'),
              headers: {'Content-Type': 'application/json'})
          .timeout(const Duration(seconds: 12));
      if (res.statusCode != 200) return false;
      final json = jsonDecode(res.body);
      return json is bool ? json : false;
    } catch (_) {
      return false;
    }
  }

  Future<bool> setErleoEnabled(bool enabled) async {
    final json = await _adminPost('/api/v1/settings/erleo-enabled',
        {'enabled': enabled});
    return json['enabled'] as bool? ?? enabled;
  }

  // ============================================================
  // Órdenes
  // ============================================================

  Future<List<CerebroOrder>> pendingOrders() async {
    final json = await _adminGet('/api/v1/report/dashboard');
    final list = json['pending'] as List? ?? const [];
    return list
        .whereType<Map<String, dynamic>>()
        .map((e) => CerebroOrder.fromJson(e))
        .toList();
  }

  Future<List<CerebroOrder>> approvedOrders() async {
    final list = await _adminGet('/api/v1/orders?status=approved');
    return (list as List)
        .whereType<Map<String, dynamic>>()
        .map((e) => CerebroOrder.fromJson(e))
        .toList();
  }

  Future<List<CerebroOrder>> history() async {
    final list = await _adminGet('/api/v1/orders');
    return (list as List)
        .whereType<Map<String, dynamic>>()
        .where((e) =>
            e['status'] != 'pending' && e['status'] != 'approved')
        .map((e) => CerebroOrder.fromJson(e))
        .toList();
  }

  Future<CerebroOrder> approveOrder(String id) async {
    final json = await _adminPost('/api/v1/orders/$id/approve', null);
    return CerebroOrder.fromJson(json);
  }

  Future<CerebroOrder> rejectOrder(String id, {String? reason}) async {
    final json = await _adminPost('/api/v1/orders/$id/reject',
        {'reason': reason ?? 'Rechazada por el admin'});
    return CerebroOrder.fromJson(json);
  }

  Future<CerebroOrder> completeOrder(String id,
      {String txHashPayout = '', String txHashRefund = ''}) async {
    final json = await _adminPost('/api/v1/orders/$id/complete', {
      'txHashPayout': txHashPayout,
      'txHashRefund': txHashRefund,
    });
    return CerebroOrder.fromJson(json);
  }

  // ============================================================
  // Reservas y comisiones
  // ============================================================

  Future<List<CerebroReserve>> reserves() async {
    final list = await _adminGet('/api/v1/reserves');
    return (list as List)
        .whereType<Map<String, dynamic>>()
        .map((e) => CerebroReserve.fromJson(e))
        .toList();
  }

  Future<CerebroReserve> saveReserve({
    required String symbol,
    String network = '',
    required String address,
    String receiveAddress = '',
    String payoutAddress = '',
  }) async {
    final json = await _adminPost('/api/v1/reserves', {
      'symbol': symbol,
      'network': network,
      'address': address,
      'receiveAddress': receiveAddress,
      'payoutAddress': payoutAddress,
    });
    return CerebroReserve.fromJson(json);
  }

  Future<void> deleteReserve(String symbol) async {
    final token = await ensureSession();
    final res = await http
        .delete(Uri.parse('${serverBase}api/v1/reserves/$symbol'),
            headers: _adminHeaders(token))
        .timeout(const Duration(seconds: 12));
    if (res.statusCode != 200) throw Exception('HTTP ${res.statusCode}');
  }

  Future<({CerebroReportTotals totals, List<Map<String, dynamic>> events})>
      commissionReport() async {
    final json = await _adminGet('/api/v1/report/commissions');
    return (
      totals: CerebroReportTotals.fromJson(json['totals'] as Map<String, dynamic>? ?? const {}),
      events: (json['events'] as List? ?? const [])
          .whereType<Map<String, dynamic>>()
          .toList(),
    );
  }

  // ============================================================
  // Clave API de la app (se muestra una sola vez)
  // ============================================================

  Future<({String apiKey, bool revealedOnce})> apiKeyInfo() async {
    final json = await _adminGet('/api/v1/settings/api-key');
    return (
      apiKey: json['apiKey'] as String? ?? '',
      revealedOnce: json['revealedOnce'] as bool? ?? false,
    );
  }

  Future<void> markApiKeyShown() async {
    await _adminPost('/api/v1/settings/api-key/reveal', null);
    await _prefs.setBool(PreferencesKey.cerebroApiKeyShown, true);
  }

  Future<String> regenerateApiKey() async {
    final json = await _adminPost('/api/v1/settings/api-key/regenerate', null);
    return json['apiKey'] as String? ?? '';
  }

  void logout() {
    _prefs.remove(PreferencesKey.cerebroAdminToken);
  }
}
