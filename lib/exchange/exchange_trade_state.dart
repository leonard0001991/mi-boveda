import 'package:cake_wallet/exchange/trade.dart';

abstract class ExchangeTradeState {}

class ExchangeTradeStateInitial extends ExchangeTradeState {}

class TradeIsCreating extends ExchangeTradeState {}

class TradeIsCreatedSuccessfully extends ExchangeTradeState {
  TradeIsCreatedSuccessfully({required this.trade});

  final Trade trade;
}

class TradeIsCreatedFailure extends ExchangeTradeState {
  TradeIsCreatedFailure({required this.title, required this.error});

  final String title;
  final String error;
}

/// Orden de intercambio propio enviada al Cerebro, esperando aprobación del admin.
class TradeIsErleoPending extends ExchangeTradeState {
  TradeIsErleoPending({required this.orderId});

  final String orderId;
}

/// El Cerebro aprobó la orden: el admin está ejecutando el envío manual.
class TradeIsErleoApproved extends ExchangeTradeState {
  TradeIsErleoApproved({required this.orderId, this.netToAmount, this.commissionUsd});

  final String orderId;
  final double? netToAmount;
  final double? commissionUsd;
}

/// El Cerebro confirmó el envío: intercambio completado por el admin.
class TradeIsErleoCompleted extends ExchangeTradeState {
  TradeIsErleoCompleted({required this.orderId, this.netToAmount});

  final String orderId;
  final double? netToAmount;
}

/// El Cerebro rechazó la orden: la app mostrará el mensaje oficial del mínimo.
class TradeIsErleoRejected extends ExchangeTradeState {
  TradeIsErleoRejected({required this.orderId, this.reason});

  final String orderId;
  final String? reason;
}

/// Fallo al comunicarse con el Cerebro (offline, no configurado, etc).
class TradeIsErleoError extends ExchangeTradeState {
  TradeIsErleoError({required this.error});

  final String error;
}
