import { useScrollReveal } from "@/hooks/useScrollReveal";
import { Monitor, FolderGit2, FileEdit, ShieldCheck } from "lucide-react";

const features = [
  {
    icon: Monitor,
    title: "桌面 Runtime 接入",
    description: "一键连接本地 Agent Runtime，立即开始任务，无需复杂配置",
  },
  {
    icon: FolderGit2,
    title: "项目级上下文",
    description: "理解项目结构与线程上下文，给出更准确的代码建议",
  },
  {
    icon: FileEdit,
    title: "工作区写入 / Diff 审阅",
    description: "改动可追踪，可回看，变更过程清晰可见",
  },
  {
    icon: ShieldCheck,
    title: "高风险操作审批",
    description: "敏感命令与越界写入需要确认，更安全可控",
  },
];

export default function Features() {
  const { ref, isVisible } = useScrollReveal<HTMLElement>();

  return (
    <section
      id="features"
      ref={ref}
      className="relative py-24 sm:py-32 bg-dark-950"
    >
      <div className="container mx-auto px-4">
        {/* Section header */}
        <div
          className={`text-center mb-16 transition-all duration-700 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
        >
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            核心能力
          </h2>
          <p className="text-dark-400 text-lg max-w-xl mx-auto">
            面向真实项目的本地编程 Agent
          </p>
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature, index) => (
            <div
              key={feature.title}
              className={`group relative p-6 rounded-2xl bg-dark-900/50 border border-dark-800 hover:border-brand-400/30 hover:bg-dark-900 transition-all duration-300 hover:-translate-y-1 ${
                isVisible
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 translate-y-6"
              }`}
              style={{
                transitionDelay: isVisible ? `${150 + index * 100}ms` : "0ms",
                transitionDuration: "700ms",
              }}
            >
              {/* Icon */}
              <div className="w-12 h-12 rounded-xl bg-brand-400/10 flex items-center justify-center mb-5 group-hover:bg-brand-400/20 transition-colors">
                <feature.icon className="w-6 h-6 text-brand-400" />
              </div>

              {/* Content */}
              <h3 className="text-lg font-semibold text-white mb-2">
                {feature.title}
              </h3>
              <p className="text-dark-400 text-sm leading-relaxed">
                {feature.description}
              </p>

              {/* Number badge */}
              <div className="absolute top-4 right-4 text-dark-700 font-mono text-xs">
                0{index + 1}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
