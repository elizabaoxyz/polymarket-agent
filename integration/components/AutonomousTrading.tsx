// Autonomous Trading Panel Component
// Add this to your elizabao project: src/components/autonomous/AutonomousTrading.tsx

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { 
  Bot, 
  Play, 
  Pause, 
  Settings, 
  TrendingUp, 
  AlertTriangle,
  CheckCircle,
  Clock,
  DollarSign,
  Activity,
  RefreshCw,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

// Types
interface AutonomousConfig {
  enabled: boolean;
  maxOrderSize: number;
  maxDailyTrades: number;
  minSpread: number;
  maxSpread: number;
  riskLevel: "conservative" | "moderate" | "aggressive";
  autoExecute: boolean;
  scanIntervalMs: number;
}

interface MarketOpportunity {
  id: string;
  question: string;
  tokenId: string;
  outcome: string;
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadPercent: number;
  midpoint: number;
  volume24h: number;
  score: number;
}

interface TradeDecision {
  shouldTrade: boolean;
  action: "BUY" | "SELL" | "HOLD";
  market: MarketOpportunity | null;
  price: number;
  size: number;
  reasoning: string;
  confidence: number;
}

interface ScanResult {
  timestamp: string;
  marketsScanned: number;
  opportunitiesFound: number;
  topOpportunities: MarketOpportunity[];
  aiDecision: TradeDecision | null;
  executedTrade: any | null;
}

interface ActivityLog {
  id: string;
  timestamp: Date;
  type: "scan" | "decision" | "trade" | "error";
  message: string;
  details?: any;
}

const DEFAULT_CONFIG: AutonomousConfig = {
  enabled: false,
  maxOrderSize: 10,
  maxDailyTrades: 5,
  minSpread: 0.5,
  maxSpread: 10,
  riskLevel: "moderate",
  autoExecute: false,
  scanIntervalMs: 60000, // 1 minute
};

export default function AutonomousTrading() {
  const [config, setConfig] = useState<AutonomousConfig>(DEFAULT_CONFIG);
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [lastScan, setLastScan] = useState<ScanResult | null>(null);
  const [activityLog, setActivityLog] = useState<ActivityLog[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tradesToday, setTradesToday] = useState(0);
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Add activity to log
  const addActivity = (type: ActivityLog["type"], message: string, details?: any) => {
    const newActivity: ActivityLog = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      type,
      message,
      details,
    };
    setActivityLog(prev => [newActivity, ...prev].slice(0, 50)); // Keep last 50
  };

  // Run a single scan cycle
  const runScan = async (execute = false) => {
    setIsLoading(true);
    addActivity("scan", "Starting market scan...");

    try {
      const { data, error } = await supabase.functions.invoke("polymarket-autonomous", {
        body: {
          action: execute ? "execute" : "analyze",
          config: {
            ...config,
            enabled: execute && config.autoExecute,
          },
        },
      });

      if (error) throw error;

      if (data?.success) {
        const result = data.data as ScanResult;
        setLastScan(result);

        addActivity("scan", `Scanned ${result.marketsScanned} markets, found ${result.opportunitiesFound} opportunities`);

        if (result.aiDecision) {
          const { aiDecision } = result;
          if (aiDecision.shouldTrade && aiDecision.market) {
            addActivity(
              "decision",
              `AI recommends ${aiDecision.action} on "${aiDecision.market.question.slice(0, 50)}..." (${aiDecision.confidence}% confidence)`,
              aiDecision
            );
          } else {
            addActivity("decision", `AI decision: HOLD - ${aiDecision.reasoning}`);
          }
        }

        if (result.executedTrade) {
          if (result.executedTrade.success) {
            addActivity("trade", `Trade executed: ${result.aiDecision?.action}`, result.executedTrade);
            setTradesToday(prev => prev + 1);
            toast.success("Trade executed successfully!");
          } else {
            addActivity("error", `Trade failed: ${result.executedTrade.error}`);
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      addActivity("error", `Scan failed: ${message}`);
      toast.error(`Scan failed: ${message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Start autonomous loop
  const startAutonomous = () => {
    if (isRunning) return;
    
    setIsRunning(true);
    addActivity("scan", "Autonomous trading started");
    toast.success("Autonomous trading started");

    // Run immediately
    runScan(config.autoExecute);

    // Set up interval
    intervalRef.current = setInterval(() => {
      if (tradesToday >= config.maxDailyTrades) {
        addActivity("decision", "Daily trade limit reached, pausing...");
        stopAutonomous();
        return;
      }
      runScan(config.autoExecute);
    }, config.scanIntervalMs);
  };

  // Stop autonomous loop
  const stopAutonomous = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsRunning(false);
    addActivity("scan", "Autonomous trading stopped");
    toast.info("Autonomous trading stopped");
  };

  // Toggle autonomous mode
  const toggleAutonomous = () => {
    if (isRunning) {
      stopAutonomous();
    } else {
      startAutonomous();
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // Format time ago
  const formatTimeAgo = (date: Date) => {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Autonomous Trading</h3>
          {isRunning && (
            <span className="flex items-center gap-1 text-xs text-green-500">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              LIVE
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => runScan(false)}
            disabled={isLoading}
          >
            {isLoading ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            <span className="ml-1">Scan</span>
          </Button>
          <Button
            variant={isRunning ? "destructive" : "default"}
            size="sm"
            onClick={toggleAutonomous}
          >
            {isRunning ? (
              <>
                <Pause className="w-4 h-4 mr-1" />
                Stop
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-1" />
                Start
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-2 text-sm">
        <div className="bg-muted/50 rounded p-2 text-center">
          <div className="text-muted-foreground text-xs">Trades Today</div>
          <div className="font-bold">{tradesToday}/{config.maxDailyTrades}</div>
        </div>
        <div className="bg-muted/50 rounded p-2 text-center">
          <div className="text-muted-foreground text-xs">Max Size</div>
          <div className="font-bold">${config.maxOrderSize}</div>
        </div>
        <div className="bg-muted/50 rounded p-2 text-center">
          <div className="text-muted-foreground text-xs">Risk</div>
          <div className="font-bold capitalize">{config.riskLevel}</div>
        </div>
        <div className="bg-muted/50 rounded p-2 text-center">
          <div className="text-muted-foreground text-xs">Auto-Execute</div>
          <div className="font-bold">{config.autoExecute ? "ON" : "OFF"}</div>
        </div>
      </div>

      {/* Last AI Decision */}
      {lastScan?.aiDecision && (
        <div className={`rounded-lg p-3 border ${
          lastScan.aiDecision.shouldTrade 
            ? "bg-green-500/10 border-green-500/30" 
            : "bg-muted/50 border-border"
        }`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4" />
              <span className="font-medium">AI Decision</span>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded ${
              lastScan.aiDecision.shouldTrade 
                ? "bg-green-500/20 text-green-500" 
                : "bg-muted text-muted-foreground"
            }`}>
              {lastScan.aiDecision.action}
            </span>
          </div>
          {lastScan.aiDecision.market && (
            <div className="text-sm mb-1">
              <span className="font-medium">{lastScan.aiDecision.market.question.slice(0, 60)}...</span>
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            {lastScan.aiDecision.reasoning}
          </div>
          {lastScan.aiDecision.shouldTrade && (
            <div className="flex items-center gap-4 mt-2 text-xs">
              <span>Price: {(lastScan.aiDecision.price * 100).toFixed(1)}%</span>
              <span>Size: ${lastScan.aiDecision.size}</span>
              <span>Confidence: {lastScan.aiDecision.confidence}%</span>
            </div>
          )}
        </div>
      )}

      {/* Top Opportunities */}
      {lastScan?.topOpportunities && lastScan.topOpportunities.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            Top Opportunities
          </div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {lastScan.topOpportunities.slice(0, 3).map((opp, i) => (
              <div key={opp.id} className="text-xs bg-muted/30 rounded p-2 flex items-center justify-between">
                <div className="flex-1 truncate">
                  <span className="text-muted-foreground mr-2">#{i + 1}</span>
                  {opp.question.slice(0, 40)}...
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span>{(opp.midpoint * 100).toFixed(0)}%</span>
                  <span className="text-green-500">+{opp.spreadPercent.toFixed(1)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Settings */}
      <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full justify-between">
            <span className="flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Settings
            </span>
            {settingsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-4">
          {/* Auto-Execute Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Auto-Execute Trades</div>
              <div className="text-xs text-muted-foreground">Automatically place orders</div>
            </div>
            <Switch
              checked={config.autoExecute}
              onCheckedChange={(checked) => setConfig(prev => ({ ...prev, autoExecute: checked }))}
            />
          </div>

          {config.autoExecute && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-2 text-xs text-yellow-500 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>Auto-execute is ON. The AI will place real trades automatically.</span>
            </div>
          )}

          {/* Max Order Size */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Max Order Size</span>
              <span>${config.maxOrderSize}</span>
            </div>
            <Slider
              value={[config.maxOrderSize]}
              onValueChange={([value]) => setConfig(prev => ({ ...prev, maxOrderSize: value }))}
              min={1}
              max={100}
              step={1}
            />
          </div>

          {/* Max Daily Trades */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Max Daily Trades</span>
              <span>{config.maxDailyTrades}</span>
            </div>
            <Slider
              value={[config.maxDailyTrades]}
              onValueChange={([value]) => setConfig(prev => ({ ...prev, maxDailyTrades: value }))}
              min={1}
              max={20}
              step={1}
            />
          </div>

          {/* Risk Level */}
          <div className="space-y-2">
            <div className="text-sm">Risk Level</div>
            <Select
              value={config.riskLevel}
              onValueChange={(value: any) => setConfig(prev => ({ ...prev, riskLevel: value }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="conservative">Conservative</SelectItem>
                <SelectItem value="moderate">Moderate</SelectItem>
                <SelectItem value="aggressive">Aggressive</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Scan Interval */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Scan Interval</span>
              <span>{config.scanIntervalMs / 1000}s</span>
            </div>
            <Slider
              value={[config.scanIntervalMs / 1000]}
              onValueChange={([value]) => setConfig(prev => ({ ...prev, scanIntervalMs: value * 1000 }))}
              min={30}
              max={300}
              step={30}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Activity Log */}
      <div className="space-y-2">
        <div className="text-sm font-medium flex items-center gap-2">
          <Clock className="w-4 h-4" />
          Activity Log
        </div>
        <div className="bg-muted/30 rounded p-2 max-h-32 overflow-y-auto space-y-1">
          {activityLog.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-2">
              No activity yet. Click "Scan" or "Start" to begin.
            </div>
          ) : (
            activityLog.map((log) => (
              <div key={log.id} className="text-xs flex items-start gap-2">
                <span className="text-muted-foreground whitespace-nowrap">
                  {formatTimeAgo(log.timestamp)}
                </span>
                <span className={`flex-shrink-0 ${
                  log.type === "error" ? "text-red-500" :
                  log.type === "trade" ? "text-green-500" :
                  log.type === "decision" ? "text-blue-500" :
                  "text-muted-foreground"
                }`}>
                  {log.type === "error" && "⚠️"}
                  {log.type === "trade" && "✅"}
                  {log.type === "decision" && "🤖"}
                  {log.type === "scan" && "🔍"}
                </span>
                <span className="text-foreground">{log.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
