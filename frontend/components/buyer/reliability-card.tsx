'use client';
import { Line, LineChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScoreGauge } from '@/components/bb/indicators';
import { CardSkeleton, DataState } from '@/components/bb/states';
import { useScores } from '@/lib/queries';
import { formatDate } from '@/lib/utils';

export function ReliabilityCard({ buyerId, title = 'Reliability score' }: { buyerId: string; title?: string }) {
  const q = useScores(buyerId);
  return (
    <DataState query={q} skeleton={<CardSkeleton rows={4} />}>
      {(d) => {
        const data = d.history.map((h) => ({ t: formatDate(h.timestamp), score: h.score, reason: h.reason }));
        return (
          <Card>
            <CardHeader><CardTitle>{title}</CardTitle><CardDescription>{d.buyerName} · score = 2·onTime / (2·onTime + 3·late + 10·default), round-half-up</CardDescription></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-[auto_1fr]">
              <div className="flex flex-col items-center gap-3">
                <ScoreGauge score={d.score.score} size={120} />
                <div className="grid grid-cols-3 gap-3 text-center text-xs">
                  <div><div className="mono text-lg font-semibold text-success">{d.score.settledOnTime}</div><div className="text-muted">on time</div></div>
                  <div><div className="mono text-lg font-semibold text-warning">{d.score.settledLate}</div><div className="text-muted">late</div></div>
                  <div><div className="mono text-lg font-semibold text-danger">{d.score.defaulted}</div><div className="text-muted">default</div></div>
                </div>
              </div>
              <div className="h-44 min-w-0">
                {data.length > 1 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                      <XAxis dataKey="t" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                      <ChartTooltip contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} labelStyle={{ color: 'var(--muted)' }} />
                      <Line type="monotone" dataKey="score" stroke="var(--primary)" strokeWidth={2} dot={{ r: 3, fill: 'var(--primary)' }} isAnimationActive />
                    </LineChart>
                  </ResponsiveContainer>
                ) : <div className="flex h-full items-center justify-center text-sm text-muted">Score history appears after the first settlement.</div>}
              </div>
            </CardContent>
          </Card>
        );
      }}
    </DataState>
  );
}
