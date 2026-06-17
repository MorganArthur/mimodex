import { useScrollReveal } from "@/hooks/useScrollReveal";
import { FolderOpen, MessageSquare, Search, Lightbulb, Shield, GitCompare, GitCommit } from "lucide-react";

const steps = [
  { icon: FolderOpen, title: "选择本地项目", desc: "选择或打开本地项目作为工作区" },
  { icon: MessageSquare, title: "创建对话线程", desc: "开启与 Agent 的对话，明确目标与需求" },
  { icon: Search, title: "理解项目上下文", desc: "Agent 读取项目结构，理解代码与依赖关系" },
  { icon: Lightbulb, title: "生成修改方案", desc: "Agent 基于需求生成可执行的修改方案" },
  { icon: Shield, title: "审批写入/命令执行", desc: "你审批后，Agent 写入文件或执行终端命令" },
  { icon: GitCompare, title: "Diff 审阅", desc: "查看变更差异，确认修改内容" },
  { icon: GitCommit, title: "Git 提交", desc: "提交到本地仓库，完成闭环" },
];

export default function Workflow() {
  const { ref, isVisible } = useScrollReveal<HTMLElement>();

  return (
    <section ref={ref} className="relative py-24 sm:py-32 bg-dark-950">
      <div className="container mx-auto px-4">
        {/* Section header */}
        <div
          className={`text-center mb-16 transition-all duration-700 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
        >
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            Mimodex 工作流
          </h2>
          <p className="text-dark-400 text-lg max-w-xl mx-auto">
            从本地项目到代码变更审阅的完整闭环
          </p>
        </div>

        {/* Workflow image */}
        <div
          className={`mb-16 transition-all duration-700 delay-200 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
          }`}
        >
          <div className="rounded-2xl overflow-hidden border border-dark-800 bg-dark-900/30">
            <img
              src="./images/工作流程图.png"
              alt="Mimodex 工作流程"
              className="w-full h-auto"
              loading="lazy"
            />
          </div>
        </div>

        {/* Steps grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4">
          {steps.map((step, index) => (
            <div
              key={step.title}
              className={`relative flex flex-col items-center text-center p-4 rounded-xl bg-dark-900/30 border border-dark-800 hover:border-brand-400/20 transition-all duration-300 group ${
                isVisible
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 translate-y-6"
              }`}
              style={{
                transitionDelay: isVisible ? `${300 + index * 80}ms` : "0ms",
                transitionDuration: "700ms",
              }}
            >
              {/* Step number */}
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-brand-400 text-dark-950 text-xs font-bold flex items-center justify-center">
                {index + 1}
              </div>

              {/* Icon */}
              <div className="w-10 h-10 rounded-lg bg-brand-400/10 flex items-center justify-center mb-3 mt-2 group-hover:bg-brand-400/20 transition-colors">
                <step.icon className="w-5 h-5 text-brand-400" />
              </div>

              {/* Content */}
              <h3 className="text-sm font-semibold text-white mb-1">
                {step.title}
              </h3>
              <p className="text-dark-500 text-xs leading-relaxed">
                {step.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
