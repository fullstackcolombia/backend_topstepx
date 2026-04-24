import swaggerUi from 'swagger-ui-express';

const okEnvelope = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', example: true },
    data: { type: 'object', additionalProperties: true }
  }
};

const errorEnvelope = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', example: false },
    error: { type: 'string', example: 'Validation failed: accounts: Required' }
  }
};

const accountSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', example: 'TSX-01' },
    firm: { type: 'string', example: 'TopstepX' },
    qty: { type: 'number', example: 30 },
    status: { type: 'string', example: 'OK' },
    pnl: { type: 'number', example: 0 },
    sync: { type: 'string', example: 'OK' },
    selected: { type: 'boolean', example: true },
    position: { type: 'number', example: 0 },
    tradesToday: { type: 'number', example: 0 }
  }
};

const accountExample = {
  id: 'TSX-01',
  firm: 'TopstepX',
  qty: 30,
  status: 'OK',
  pnl: 145.5,
  sync: 'OK',
  selected: true,
  position: 1,
  tradesToday: 2
};

const accountsExample = [
  accountExample,
  {
    id: 'TSX-02',
    firm: 'TopstepX',
    qty: 15,
    status: 'OK',
    pnl: -32.25,
    sync: 'OK',
    selected: true,
    position: 0,
    tradesToday: 1
  }
];

const healthExample = {
  ok: true,
  data: {
    service: 'panel-topstepx',
    mode: 'paper',
    ts: '2026-04-24T12:00:00.000Z'
  }
};

const selectionExample = {
  ok: true,
  data: ['TSX-01', 'TSX-02']
};

const riskExample = {
  ok: true,
  data: {
    maxLossDaily: 1000,
    maxTradesDaily: 5,
    killSwitch: 'armed',
    globalMode: 'auto'
  }
};

const overviewExample = {
  ok: true,
  data: {
    mode: 'paper',
    connection: {
      engine: 'ACTIVE',
      ws: 'CONNECTED',
      supabase: 'CONNECTED',
      topstepx: 'CONNECTED',
      lastHeartbeat: '2026-04-24T12:00:05.000Z'
    },
    risk: riskExample.data,
    totalPnl: 113.25,
    market: {
      instrument: 'NQ SEP26',
      price: 18352.5,
      history: [18346.75, 18349.25, 18352.5]
    },
    strategyState: {
      coc: {
        armed: true,
        config: {
          accounts: ['TSX-01'],
          enabled: true,
          baseTimeframe: '1s'
        }
      },
      orb: {
        armed: false,
        config: null
      }
    },
    accounts: accountsExample
  }
};

const orderEventExample = {
  ok: true,
  data: {
    id: 'ORD-1713960000000-321',
    ts: '2026-04-24T12:00:10.000Z',
    kind: 'manual',
    order: {
      orderType: 'BUY_MARKET',
      accounts: ['TSX-01'],
      instrument: 'NQ SEP26',
      qty: 1,
      stopLoss: 20,
      takeProfit: 60,
      breakEvenTrigger: 12,
      trailingTrigger: 18,
      trailingStep: 4,
      runnerQty: 0,
      mode: 'manual'
    },
    fills: [
      {
        accountId: 'TSX-01',
        side: 'BUY',
        qty: 1,
        fillPrice: 18352.5,
        tradePnl: 4.75,
        runningPnl: 150.25,
        position: 1
      }
    ]
  }
};

const reverseEventExample = {
  ok: true,
  data: {
    id: 'REV-1713960000000',
    ts: '2026-04-24T12:00:15.000Z',
    kind: 'reverse',
    payload: {
      accounts: ['TSX-01'],
      instrument: 'NQ SEP26',
      mode: 'semi'
    },
    fills: [
      {
        accountId: 'TSX-01',
        side: 'SELL',
        qty: 2,
        fillPrice: 18351.25,
        tradePnl: -3.5,
        runningPnl: 146.75,
        position: -1
      }
    ]
  }
};

const flattenEventExample = {
  ok: true,
  data: {
    id: 'FLT-1713960000000',
    ts: '2026-04-24T12:00:18.000Z',
    kind: 'flatten-all',
    payload: {
      accounts: ['TSX-01', 'TSX-02']
    },
    fills: [
      {
        accountId: 'TSX-01',
        side: 'SELL',
        qty: 1,
        fillPrice: 18350.75,
        tradePnl: 1.2,
        runningPnl: 147.95,
        position: 0
      }
    ]
  }
};

const cancelEventExample = {
  ok: true,
  data: {
    id: 'CXL-1713960000000',
    ts: '2026-04-24T12:00:20.000Z',
    kind: 'cancel-all',
    payload: {
      accounts: ['TSX-01', 'TSX-02']
    }
  }
};

const syncResetExample = {
  ok: true,
  data: {
    reset: 2
  }
};

const strategyStateExample = {
  ok: true,
  data: {
    coc: {
      armed: true,
      config: {
        accounts: ['TSX-01'],
        enabled: true,
        baseTimeframe: '1s',
        entryOffsetTicks: 1,
        minRangeTicks: 6,
        maxRangeTicks: 24,
        maxActivationWindowSeconds: 20,
        partialTimeSeconds: 15,
        partialProfitDollars: 150,
        partialCloseQty: 1,
        baseOrder: {
          orderType: 'BUY_MARKET',
          accounts: ['TSX-01'],
          instrument: 'NQ SEP26',
          qty: 1,
          stopLoss: 20,
          takeProfit: 60,
          breakEvenTrigger: 12,
          trailingTrigger: 18,
          trailingStep: 4,
          runnerQty: 0,
          mode: 'auto'
        }
      }
    },
    orb: {
      armed: false,
      config: null
    }
  }
};

const snapshotExample = {
  ok: true,
  data: {
    overview: overviewExample.data,
    orders: [orderEventExample.data],
    logs: [
      {
        id: '1713960000000-ab12',
        ts: '2026-04-24T12:00:22.000Z',
        level: 'INFO',
        message: 'Manual order executed: BUY_MARKET',
        data: orderEventExample.data
      }
    ]
  }
};

const wsSnapshotExample = {
  type: 'snapshot',
  data: snapshotExample.data
};

const wsMarketTickExample = {
  type: 'market_tick',
  data: {
    type: 'market_tick',
    ts: '2026-04-24T12:00:25.000Z',
    instrument: 'NQ SEP26',
    price: 18353.75,
    change: 1.25,
    indicators: {
      sma20: 18349.18,
      ema20: 18350.02
    }
  }
};

const wsOverviewExample = {
  type: 'overview',
  data: overviewExample.data
};

const wsStrategyFillExample = {
  type: 'strategy_fill',
  strategy: 'COC',
  result: orderEventExample.data
};

const wsOrderExecutedExample = {
  type: 'order_executed',
  data: orderEventExample.data
};

const wsCancelAllExample = {
  type: 'cancel_all',
  data: cancelEventExample.data
};

const wsFlattenAllExample = {
  type: 'flatten_all',
  data: flattenEventExample.data
};

const wsReverseExample = {
  type: 'reverse',
  data: reverseEventExample.data
};

const wsSyncResetExample = {
  type: 'sync_reset',
  data: {
    accounts: ['TSX-01', 'TSX-02']
  }
};

const simpleAccountsSchema = {
  type: 'object',
  required: ['accounts'],
  properties: {
    accounts: {
      type: 'array',
      minItems: 1,
      items: { type: 'string' },
      example: ['TSX-01', 'TSX-02']
    }
  }
};

const riskConfigSchema = {
  type: 'object',
  required: ['maxLossDaily', 'maxTradesDaily', 'killSwitch', 'globalMode'],
  properties: {
    maxLossDaily: { type: 'number', minimum: 1, maximum: 50000, example: 1000 },
    maxTradesDaily: { type: 'integer', minimum: 1, maximum: 100, example: 5 },
    killSwitch: { type: 'string', enum: ['armed', 'off'], example: 'armed' },
    globalMode: { type: 'string', enum: ['manual', 'semi', 'auto'], example: 'auto' }
  }
};

const baseOrderSchema = {
  type: 'object',
  required: ['orderType', 'accounts', 'instrument', 'qty', 'stopLoss', 'takeProfit', 'breakEvenTrigger', 'trailingTrigger', 'trailingStep', 'runnerQty', 'mode'],
  properties: {
    orderType: {
      type: 'string',
      enum: ['BUY_MARKET', 'SELL_MARKET', 'BUY_STOP', 'SELL_STOP', 'OCO_BRACKET', 'BREAKOUT_BRACKET'],
      example: 'BUY_MARKET'
    },
    accounts: {
      type: 'array',
      minItems: 1,
      items: { type: 'string' },
      example: ['TSX-01']
    },
    instrument: { type: 'string', example: 'NQ SEP26' },
    qty: { type: 'integer', minimum: 1, maximum: 200, example: 1 },
    stopLoss: { type: 'number', minimum: 1, maximum: 200, example: 20 },
    takeProfit: { type: 'number', minimum: 1, maximum: 400, example: 60 },
    breakEvenTrigger: { type: 'number', minimum: 0, maximum: 200, example: 12 },
    trailingTrigger: { type: 'number', minimum: 0, maximum: 200, example: 18 },
    trailingStep: { type: 'number', minimum: 1, maximum: 100, example: 4 },
    runnerQty: { type: 'integer', minimum: 0, maximum: 100, example: 0 },
    mode: { type: 'string', enum: ['manual', 'semi', 'auto'], example: 'manual' }
  }
};

const reverseSchema = {
  type: 'object',
  required: ['accounts', 'instrument', 'mode'],
  properties: {
    accounts: {
      type: 'array',
      minItems: 1,
      items: { type: 'string' },
      example: ['TSX-01']
    },
    instrument: { type: 'string', example: 'NQ SEP26' },
    mode: { type: 'string', enum: ['manual', 'semi', 'auto'], example: 'semi' }
  }
};

const cocSchema = {
  type: 'object',
  required: ['accounts', 'enabled', 'baseTimeframe', 'entryOffsetTicks', 'minRangeTicks', 'maxRangeTicks', 'maxActivationWindowSeconds', 'partialTimeSeconds', 'partialProfitDollars', 'partialCloseQty', 'baseOrder'],
  properties: {
    accounts: {
      type: 'array',
      minItems: 1,
      items: { type: 'string' },
      example: ['TSX-01']
    },
    enabled: { type: 'boolean', example: true },
    baseTimeframe: { type: 'string', enum: ['1s', '2s', '5s'], example: '1s' },
    entryOffsetTicks: { type: 'integer', minimum: 0, maximum: 10, example: 1 },
    minRangeTicks: { type: 'integer', minimum: 1, maximum: 100, example: 6 },
    maxRangeTicks: { type: 'integer', minimum: 2, maximum: 200, example: 24 },
    maxActivationWindowSeconds: { type: 'integer', minimum: 1, maximum: 120, example: 20 },
    partialTimeSeconds: { type: 'integer', minimum: 1, maximum: 120, example: 15 },
    partialProfitDollars: { type: 'number', minimum: 10, maximum: 10000, example: 150 },
    partialCloseQty: { type: 'integer', minimum: 1, maximum: 100, example: 1 },
    baseOrder: baseOrderSchema
  }
};

const orbSchema = {
  type: 'object',
  required: ['accounts', 'enabled', 'timeframe', 'volumeMultiplier', 'requireRetest', 'tp1Qty', 'tp2Qty', 'tp1ProfitDollars', 'tp2ProfitDollars', 'runnerQty', 'baseOrder'],
  properties: {
    accounts: {
      type: 'array',
      minItems: 1,
      items: { type: 'string' },
      example: ['TSX-01']
    },
    enabled: { type: 'boolean', example: true },
    timeframe: { type: 'string', enum: ['1m', '5m', '15m', '1h'], example: '5m' },
    volumeMultiplier: { type: 'number', minimum: 0.5, maximum: 5, example: 1.5 },
    requireRetest: { type: 'boolean', example: true },
    tp1Qty: { type: 'integer', minimum: 1, maximum: 100, example: 1 },
    tp2Qty: { type: 'integer', minimum: 1, maximum: 100, example: 1 },
    tp1ProfitDollars: { type: 'number', minimum: 10, maximum: 10000, example: 250 },
    tp2ProfitDollars: { type: 'number', minimum: 10, maximum: 20000, example: 500 },
    runnerQty: { type: 'integer', minimum: 0, maximum: 100, example: 0 },
    baseOrder: baseOrderSchema
  }
};

function buildSpec() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Panel TopstepX API',
      version: '1.0.0',
      description: 'REST API and WebSocket control surface for the TopstepX execution panel.'
    },
    servers: [{ url: '/', description: 'Current host' }],
    tags: [
      { name: 'Health' },
      { name: 'Accounts' },
      { name: 'State' },
      { name: 'Risk' },
      { name: 'Orders' },
      { name: 'Strategies' },
      { name: 'Replicator' },
      { name: 'WebSocket' }
    ],
    components: {
      schemas: {
        OkEnvelope: okEnvelope,
        ErrorEnvelope: errorEnvelope,
        Account: accountSchema,
        SimpleAccounts: simpleAccountsSchema,
        RiskConfig: riskConfigSchema,
        BaseOrder: baseOrderSchema,
        ReverseOrder: reverseSchema,
        CocStrategy: cocSchema,
        OrbStrategy: orbSchema,
        StrategyToggle: {
          allOf: [
            simpleAccountsSchema,
            {
              type: 'object',
              required: ['enabled'],
              properties: {
                enabled: { type: 'boolean', example: true }
              }
            }
          ]
        },
        WebSocketEnvelope: {
          type: 'object',
          required: ['type', 'data'],
          properties: {
            type: { type: 'string', example: 'overview' },
            data: { type: 'object', additionalProperties: true }
          }
        }
      },
      responses: {
        ValidationError: {
          description: 'Validation or domain error',
          content: {
            'application/json': {
              schema: errorEnvelope
            }
          }
        }
      }
    },
    paths: {
      '/api/health': {
        get: {
          tags: ['Health'],
          summary: 'Health check',
          responses: {
            200: {
              description: 'Service status',
              content: {
                'application/json': {
                  schema: okEnvelope,
                  example: healthExample
                }
              }
            }
          }
        }
      },
      '/api/accounts': {
        get: {
          tags: ['Accounts'],
          summary: 'List available accounts',
          responses: {
            200: {
              description: 'Accounts currently tracked by the engine',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      ok: { type: 'boolean', example: true },
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Account' }
                      }
                    },
                    example: {
                      ok: true,
                      data: accountsExample
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/accounts/selection': {
        post: {
          tags: ['Accounts'],
          summary: 'Update selected accounts',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SimpleAccounts' }
              }
            }
          },
          responses: {
            200: {
              description: 'Selection updated',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      ok: { type: 'boolean', example: true },
                      data: {
                        type: 'array',
                        items: { type: 'string' }
                      }
                    }
                  },
                  example: selectionExample
                }
              }
            },
            400: { $ref: '#/components/responses/ValidationError' }
          }
        }
      },
      '/api/state/overview': {
        get: {
          tags: ['State'],
          summary: 'Get state overview',
          responses: {
            200: {
              description: 'Current overview snapshot',
              content: {
                'application/json': {
                  schema: okEnvelope,
                  example: overviewExample
                }
              }
            }
          }
        }
      },
      '/api/state/snapshot': {
        get: {
          tags: ['State'],
          summary: 'Get full runtime snapshot',
          responses: {
            200: {
              description: 'Complete engine snapshot',
              content: {
                'application/json': {
                  schema: okEnvelope,
                  example: snapshotExample
                }
              }
            }
          }
        }
      },
      '/api/risk/config': {
        post: {
          tags: ['Risk'],
          summary: 'Set risk configuration',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RiskConfig' }
              }
            }
          },
          responses: {
            200: {
              description: 'Risk configuration updated',
              content: {
                'application/json': {
                  schema: okEnvelope,
                  example: riskExample
                }
              }
            },
            400: { $ref: '#/components/responses/ValidationError' }
          }
        }
      },
      '/api/orders/manual': {
        post: {
          tags: ['Orders'],
          summary: 'Submit a manual order',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/BaseOrder' }
              }
            }
          },
          responses: {
            200: {
              description: 'Order executed',
              content: {
                'application/json': {
                  schema: okEnvelope,
                  example: orderEventExample
                }
              }
            },
            400: { $ref: '#/components/responses/ValidationError' }
          }
        }
      },
      '/api/orders/cancel-all': {
        post: {
          tags: ['Orders'],
          summary: 'Cancel all working orders for accounts',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SimpleAccounts' }
              }
            }
          },
          responses: {
            200: {
              description: 'Orders cancelled',
              content: {
                'application/json': {
                  schema: okEnvelope,
                  example: cancelEventExample
                }
              }
            },
            400: { $ref: '#/components/responses/ValidationError' }
          }
        }
      },
      '/api/orders/flatten-all': {
        post: {
          tags: ['Orders'],
          summary: 'Flatten positions for accounts',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SimpleAccounts' }
              }
            }
          },
          responses: {
            200: {
              description: 'Positions flattened',
              content: {
                'application/json': {
                  schema: okEnvelope,
                  example: flattenEventExample
                }
              }
            },
            400: { $ref: '#/components/responses/ValidationError' }
          }
        }
      },
      '/api/orders/reverse': {
        post: {
          tags: ['Orders'],
          summary: 'Reverse positions',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ReverseOrder' }
              }
            }
          },
          responses: {
            200: {
              description: 'Positions reversed',
              content: {
                'application/json': {
                  schema: okEnvelope,
                  example: reverseEventExample
                }
              }
            },
            400: { $ref: '#/components/responses/ValidationError' }
          }
        }
      },
      '/api/replicator/sync-reset': {
        post: {
          tags: ['Replicator'],
          summary: 'Reset sync state for accounts',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SimpleAccounts' }
              }
            }
          },
          responses: {
            200: {
              description: 'Replicator sync reset',
              content: {
                'application/json': {
                  schema: okEnvelope,
                  example: syncResetExample
                }
              }
            },
            400: { $ref: '#/components/responses/ValidationError' }
          }
        }
      },
      '/api/strategies/coc/arm': {
        post: {
          tags: ['Strategies'],
          summary: 'Arm the COC strategy',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CocStrategy' }
              }
            }
          },
          responses: {
            200: {
              description: 'COC strategy updated',
              content: {
                'application/json': {
                  schema: okEnvelope,
                  example: strategyStateExample
                }
              }
            },
            400: { $ref: '#/components/responses/ValidationError' }
          }
        }
      },
      '/api/strategies/orb/arm': {
        post: {
          tags: ['Strategies'],
          summary: 'Arm the ORB strategy',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/OrbStrategy' }
              }
            }
          },
          responses: {
            200: {
              description: 'ORB strategy updated',
              content: {
                'application/json': {
                  schema: okEnvelope,
                  example: strategyStateExample
                }
              }
            },
            400: { $ref: '#/components/responses/ValidationError' }
          }
        }
      },
      '/api/strategies/{id}/toggle': {
        post: {
          tags: ['Strategies'],
          summary: 'Enable or disable a configured strategy',
          parameters: [
            {
              in: 'path',
              name: 'id',
              required: true,
              schema: { type: 'string', enum: ['coc', 'orb'] }
            }
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/StrategyToggle' }
              }
            }
          },
          responses: {
            200: {
              description: 'Strategy toggle applied',
              content: {
                'application/json': {
                  schema: okEnvelope,
                  example: strategyStateExample
                }
              }
            },
            400: { $ref: '#/components/responses/ValidationError' },
            404: { $ref: '#/components/responses/ValidationError' },
            409: { $ref: '#/components/responses/ValidationError' }
          }
        }
      },
      '/ws': {
        get: {
          tags: ['WebSocket'],
          summary: 'WebSocket endpoint',
          description: 'Upgrade this route to WebSocket to receive snapshot, market ticks, overview broadcasts, order events, and strategy events.',
          responses: {
            101: {
              description: 'WebSocket upgrade',
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      { $ref: '#/components/schemas/WebSocketEnvelope' }
                    ]
                  },
                  examples: {
                    snapshot: {
                      summary: 'Initial snapshot sent on connect',
                      value: wsSnapshotExample
                    },
                    marketTick: {
                      summary: 'Market tick broadcast every second',
                      value: wsMarketTickExample
                    },
                    overview: {
                      summary: 'Overview broadcast',
                      value: wsOverviewExample
                    },
                    strategyFill: {
                      summary: 'Strategy execution event',
                      value: wsStrategyFillExample
                    },
                    orderExecuted: {
                      summary: 'Manual order broadcast',
                      value: wsOrderExecutedExample
                    },
                    cancelAll: {
                      summary: 'Cancel-all event',
                      value: wsCancelAllExample
                    },
                    flattenAll: {
                      summary: 'Flatten-all event',
                      value: wsFlattenAllExample
                    },
                    reverse: {
                      summary: 'Reverse positions event',
                      value: wsReverseExample
                    },
                    syncReset: {
                      summary: 'Replicator reset event',
                      value: wsSyncResetExample
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  };
}

export function registerSwagger(app) {
  const spec = buildSpec();

  app.get('/docs.json', (_req, res) => {
    res.status(200).json(spec);
  });

  app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec, {
    customSiteTitle: 'Panel TopstepX API Docs',
    explorer: true
  }));
}