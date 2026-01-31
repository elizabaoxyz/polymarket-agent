// Compact Autonomous Trading Widget (for sidebar)
// Add this to your elizabao project: src/components/autonomous/AutonomousTradingCompact.tsx

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { 
  Bot, 
  Play, 
  Pause, 
  TrendingUp, 
  RefreshCw,
  Zap
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

interface MarketOpportunity {
  question: string;
  midpoint: number;
  spreadPercent: number;
  score: number;
}

interface TradeDecision {
  shouldTrade: boolean;
  action: "BUY" | "SELL" | "HOLD";
  market: MarketOpportunity | null;
  reasoning: string;
  confidence: number;
}

export default function AutonomousTradingCompact() {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [decision, setDecision] = useState<TradeDecision | null>(null);
  const [opportunities, setOpportunities] = useState<MarketOpportunity[]>([]);

  const runAnalysis = async () => {
    setIsLoading(true);
    
    try {
      const { data, error } = await supabase.functions.invoke("polymarket-autonomous", {
        body: {
          action: "analyze",
          config: {
            maxOrderSize: 10,
            riskLevel: "moderate",
            minSpread: 0.5,
            maxSpread: 10,
          },
        },
      });

      if (error) throw error;

      if (data?.success) {
        setDecision(data.data.aiDecision);
        setOpportunities(data.data.topOpportunities?.slice(0, 3) || []);
        
        if (data.data.aiDecision?.shouldTrade) {
          toast.success(`AI found opportunity: ${data.data.aiDecision.action}`);
        } else {
          toast.info("AI: No strong opportunities right now");
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Analysis failed";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-card/50 border border-border rounded-lg p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">AI Trading</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={runAnalysis}
          disabled={isLoading}
          className="h-7 px-2"
        >
          {isLoading ? (
            <RefreshCw className="w-3 h-3 animate-spin" />
          ) : (
            <Zap className="w-3 h-3" />
          )}
          <span className="ml-1 text-xs">Analyze</span>
        </Button>
      </div>

      {/* AI Decision */}
      {decision && (
        <div className={`rounded p-2 text-xs ${
          decision.shouldTrade 
            ? "bg-green-500/10 border border-green-500/30" 
            : "bg-muted/50"
        }`}>
          <div className="flex items-center justify-between mb-1">
            <span className="font-medium">
              {decision.shouldTrade ? "🎯 Opportunity Found" : "⏸️ Hold"}
            </span>
            {decision.shouldTrade && (
              <span className="text-green-500 font-bold">
                {decision.action}
              </span>
            )}
          </div>
          {decision.market && (
            <div className="text-muted-foreground truncate">
              {decision.market.question.slice(0, 35)}...
            </div>
          )}
          <div className="text-muted-foreground mt-1">
            {decision.reasoning.slice(0, 60)}...
          </div>
        </div>
      )}

      {/* Top Markets */}
      {opportunities.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />
            Top Markets
          </div>
          {opportunities.map((opp, i) => (
            <div key={i} className="text-xs flex items-center justify-between bg-muted/30 rounded px-2 py-1">
              <span className="truncate flex-1">{opp.question.slice(0, 25)}...</span>
              <span className="text-green-500 ml-2">
                {(opp.score * 100).toFixed(0)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!decision && !isLoading && (
        <div className="text-xs text-muted-foreground text-center py-2">
          Click "Analyze" to scan markets
        </div>
      )}
    </div>
  );
}
