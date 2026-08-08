import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@linkiq/ui';
import Link from 'next/link';

export default function LoginPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Welcome back</CardTitle>
        <CardDescription>
          Log in to your LinkIQ account to continue.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" placeholder="you@company.com" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" placeholder="••••••••" />
        </div>
        <Button className="w-full" disabled>
          Log in
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link
            href="/register"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Sign up
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
