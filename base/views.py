from django.http import HttpResponse
from django.shortcuts import render, redirect
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.contrib.auth import authenticate, login, logout
from django.db.models import Q
from .models import Room, Topic
from .forms import RoomForm
# Create your views here.
# rooms = [
#     {'id':1, 'name':'Lets learn python django'},
#     {'id':2, 'name':'Lets learn React and Ajax'},
#     {'id':3, 'name':'Lets learn python Pivot tables, chart.js and apex charts'},
# ]
def login_page(request):
    if request.user.is_authenticated:
        messages.success(request, "User is already Logged in")
        return redirect('home')
        
    if request.method == "POST":
        username = request.POST.get('username')
        password = request.POST.get('password')

        try:
            user = User.objects.get(username=username)
        except:
            messages.error(request, "User does not exist")
        user= authenticate(request, username=username, password=password)
        if user is not None:
            login(request, user)
            messages.success(request, f'Welcome {username}, You have successfully logged in')
            return redirect('home')
        else:
            messages.error(request, 'Invalid Username or Password')

    context = {}
    return render(request, 'base/login_register.html', context)
def logout_user(request):
    logout(request)
    return redirect('home')

def home(request):
    q=request.GET.get('q')
    if request.GET.get('q') == None:
        q=''
    rooms=Room.objects.filter( #search functionality, have any of the below
        Q(topic__name__icontains=q) |
        Q(name__icontains=q) |
        Q(description__icontains=q) |
        Q(host__username__icontains=q)
    )
    topics=Topic.objects.all()
    room_count=rooms.count()

    context={'rooms':rooms, 'topics':topics, 'room_count':room_count}
    return render(request, 'base/home.html', context)

def room(request, pk):
    room=Room.objects.get(id=pk)
    context = {'room': room}
    return render(request, 'base/room.html', context)

@login_required(login_url='/login')
def create_room(request):
    form = RoomForm()
    if request.method == "POST":
        form = RoomForm(request.POST)
        if form.is_valid():
            form.save()
            return redirect('home')

    context={'form':form}
    return render(request, 'base/room_form.html', context)

@login_required(login_url='/login')
def update_room(request, pk):
    room = Room.objects.get(id=pk)
    form = RoomForm(instance=room)

    if request.user != room.host:
        return HttpResponse("You Do Not Have the Necessary Privileges!")

    if request.method == "POST":
        form = RoomForm(request.POST, instance=room)
        if form.is_valid():
            form.save()
            return redirect('home')

    context = {'form':form}
    return render(request, 'base/room_form.html', context)

@login_required(login_url='/login')
def delete_room(request, pk):
    room=Room.objects.get(id=pk)

    if request.user != room.host:
        return HttpResponse("You Do Not Have the Necessary Privileges!")

    if request.method == "POST":
        room.delete()
        return redirect('home')
    return render(request, 'base/delete.html', {'obj':room})






